//! Unauthenticated browser telemetry intake: real-user performance metrics and CSP violation
//! reports. Browsers send these without credentials (CSP reports cannot carry an Authorization
//! header), so the endpoints are defensive by construction:
//!
//! * request bodies are small and parsed strictly,
//! * every string is stripped of control characters (no log injection), URLs are reduced to a path
//!   or an origin so tokens in query strings never reach the logs, and lengths are capped,
//! * a bounded per-client token bucket stops one client from flooding the logs.
//!
//! Records go to structured logs (`web_vitals`, `csp` targets) where the existing log pipeline can
//! aggregate them. Nothing here touches the database or any tenant data.

use crate::{auth::client_ip, handlers::SharedState};
use axum::{
    extract::{Request, State},
    http::StatusCode,
    response::{IntoResponse, Response},
};
use serde::Deserialize;
use serde_json::Value;
use std::{collections::HashMap, net::IpAddr, sync::Mutex, time::Instant};

pub const MAX_BODY_BYTES: usize = 8 * 1024;
const MAX_METRICS: usize = 12;
const MAX_ERRORS: usize = 5;
const MAX_TEXT: usize = 200;

/// Per-client token bucket with a hard cap on tracked clients (oldest idle entry is evicted).
pub struct IntakeLimiter {
    capacity: f64,
    refill_per_sec: f64,
    max_clients: usize,
    buckets: Mutex<HashMap<IpAddr, (f64, Instant)>>,
}

impl IntakeLimiter {
    pub fn new(capacity: u32, refill_per_minute: u32, max_clients: usize) -> Self {
        Self {
            capacity: f64::from(capacity),
            refill_per_sec: f64::from(refill_per_minute) / 60.0,
            max_clients: max_clients.max(1),
            buckets: Mutex::new(HashMap::new()),
        }
    }

    pub fn allow(&self, client: IpAddr) -> bool {
        self.allow_at(client, Instant::now())
    }

    pub fn allow_at(&self, client: IpAddr, now: Instant) -> bool {
        let mut buckets = self
            .buckets
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let at_capacity = !buckets.contains_key(&client) && buckets.len() >= self.max_clients;
        let oldest = at_capacity
            .then(|| {
                buckets
                    .iter()
                    .min_by_key(|(_, (_, seen))| *seen)
                    .map(|(ip, _)| *ip)
            })
            .flatten();
        if let Some(oldest) = oldest {
            buckets.remove(&oldest);
        }
        let entry = buckets.entry(client).or_insert((self.capacity, now));
        let elapsed = now.saturating_duration_since(entry.1).as_secs_f64();
        entry.0 = (entry.0 + elapsed * self.refill_per_sec).min(self.capacity);
        entry.1 = now;
        if entry.0 >= 1.0 {
            entry.0 -= 1.0;
            true
        } else {
            false
        }
    }

    pub fn tracked_clients(&self) -> usize {
        self.buckets
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .len()
    }
}

/// Removes control characters (including newlines) and caps the length on a character boundary.
pub fn sanitize_text(input: &str, max: usize) -> String {
    input
        .chars()
        .filter(|c| !c.is_control())
        .take(max)
        .collect::<String>()
        .trim()
        .to_string()
}

/// `https://app.example.com/app/fleet?token=abc#x` -> `/app/fleet`. Relative paths are accepted too.
pub fn path_only(uri: &str) -> String {
    let without_scheme = match uri.find("://") {
        Some(index) => {
            let rest = &uri[index + 3..];
            rest.find('/').map(|slash| &rest[slash..]).unwrap_or("/")
        }
        None => uri,
    };
    let end = without_scheme
        .find(['?', '#'])
        .unwrap_or(without_scheme.len());
    sanitize_text(&without_scheme[..end], MAX_TEXT)
}

/// `https://cdn.example.com/a/b.js?x=1` -> `https://cdn.example.com`. Keywords such as `inline`,
/// `eval` and `data` are kept as is.
pub fn origin_only(uri: &str) -> String {
    match uri.find("://") {
        Some(index) => {
            let rest = &uri[index + 3..];
            let host_end = rest.find(['/', '?', '#']).unwrap_or(rest.len());
            sanitize_text(
                &format!("{}://{}", &uri[..index], &rest[..host_end]),
                MAX_TEXT,
            )
        }
        None => sanitize_text(uri.split([':', '/', '?', '#']).next().unwrap_or(""), 32),
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VitalsReport {
    pub page: String,
    #[serde(default)]
    pub release: Option<String>,
    #[serde(default)]
    pub metrics: Vec<VitalMetric>,
    #[serde(default)]
    pub errors: Vec<ClientError>,
}

#[derive(Debug, Deserialize)]
pub struct VitalMetric {
    pub name: String,
    pub value: f64,
    #[serde(default)]
    pub rating: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct ClientError {
    pub kind: String,
    pub message: String,
}

const METRIC_NAMES: [&str; 6] = ["LCP", "CLS", "INP", "FCP", "TTFB", "FID"];
const RATINGS: [&str; 3] = ["good", "needs-improvement", "poor"];

/// A validated, bounded metric ready to log.
#[derive(Debug, PartialEq)]
pub struct CleanMetric {
    pub name: &'static str,
    pub value: f64,
    pub rating: &'static str,
}

/// Keeps only well-formed metrics: known names, finite values within a sane range.
pub fn clean_metrics(metrics: &[VitalMetric]) -> Vec<CleanMetric> {
    metrics
        .iter()
        .take(MAX_METRICS)
        .filter_map(|metric| {
            let name = METRIC_NAMES.iter().find(|known| **known == metric.name)?;
            if !metric.value.is_finite() || metric.value < 0.0 || metric.value > 600_000.0 {
                return None;
            }
            let rating = RATINGS
                .iter()
                .find(|known| Some(**known) == metric.rating.as_deref())
                .copied()
                .unwrap_or("unrated");
            Some(CleanMetric {
                name,
                value: (metric.value * 1000.0).round() / 1000.0,
                rating,
            })
        })
        .collect()
}

async fn read_body(request: Request) -> Result<Vec<u8>, StatusCode> {
    let (_, body) = request.into_parts();
    let bytes = axum::body::to_bytes(body, MAX_BODY_BYTES)
        .await
        .map_err(|_| StatusCode::PAYLOAD_TOO_LARGE)?;
    Ok(bytes.to_vec())
}

/// Shared admission check: bounded per-client rate limit, then body-size and JSON validation.
/// Clients without a resolvable address share one bucket, which still bounds the total.
fn admit(limiter: &IntakeLimiter, ip: Option<IpAddr>, body: &[u8]) -> Result<(), StatusCode> {
    if !limiter.allow(ip.unwrap_or(IpAddr::from([0, 0, 0, 0]))) {
        return Err(StatusCode::TOO_MANY_REQUESTS);
    }
    if body.len() > MAX_BODY_BYTES {
        return Err(StatusCode::PAYLOAD_TOO_LARGE);
    }
    Ok(())
}

pub fn process_web_vitals(limiter: &IntakeLimiter, ip: Option<IpAddr>, body: &[u8]) -> StatusCode {
    if let Err(status) = admit(limiter, ip, body) {
        return status;
    }
    let Ok(report) = serde_json::from_slice::<VitalsReport>(body) else {
        return StatusCode::BAD_REQUEST;
    };
    let page = path_only(&report.page);
    let release = sanitize_text(report.release.as_deref().unwrap_or(""), 40);
    for metric in clean_metrics(&report.metrics) {
        tracing::info!(
            target: "web_vitals",
            page = %page,
            release = %release,
            metric = metric.name,
            value = metric.value,
            rating = metric.rating,
            "web vital"
        );
    }
    for error in report.errors.iter().take(MAX_ERRORS) {
        tracing::warn!(
            target: "web_errors",
            page = %page,
            release = %release,
            kind = %sanitize_text(&error.kind, 24),
            message = %sanitize_text(&error.message, MAX_TEXT),
            "client error"
        );
    }
    StatusCode::NO_CONTENT
}

pub async fn web_vitals_handler(State(state): State<SharedState>, request: Request) -> Response {
    let ip = client_ip(&request, state.config.trust_proxy_headers);
    match read_body(request).await {
        Ok(body) => process_web_vitals(&state.intake_limiter, ip, &body).into_response(),
        Err(status) => status.into_response(),
    }
}

/// A CSP violation reduced to fields that are safe to log.
#[derive(Debug, PartialEq)]
pub struct CspViolation {
    pub document: String,
    pub directive: String,
    pub blocked: String,
    pub disposition: String,
}

fn string_field<'a>(object: &'a Value, keys: &[&str]) -> &'a str {
    keys.iter()
        .find_map(|key| object.get(*key).and_then(Value::as_str))
        .unwrap_or("")
}

fn violation_from(report: &Value) -> Option<CspViolation> {
    let directive = sanitize_text(
        string_field(
            report,
            &[
                "effectiveDirective",
                "effective-directive",
                "violatedDirective",
                "violated-directive",
            ],
        ),
        64,
    );
    if directive.is_empty() {
        return None;
    }
    Some(CspViolation {
        document: path_only(string_field(
            report,
            &["documentURL", "document-uri", "documentUri"],
        )),
        directive,
        blocked: origin_only(string_field(
            report,
            &["blockedURL", "blocked-uri", "blockedUri"],
        )),
        disposition: sanitize_text(string_field(report, &["disposition"]), 16),
    })
}

/// Accepts both report formats: legacy `{"csp-report": {...}}` and Reporting API
/// `[{"type": "csp-violation", "body": {...}}]`.
pub fn parse_csp_reports(body: &[u8]) -> Vec<CspViolation> {
    let Ok(value) = serde_json::from_slice::<Value>(body) else {
        return Vec::new();
    };
    let candidates: Vec<&Value> = match &value {
        Value::Array(items) => items
            .iter()
            .filter(|item| item.get("type").and_then(Value::as_str) == Some("csp-violation"))
            .filter_map(|item| item.get("body"))
            .collect(),
        Value::Object(map) => map.get("csp-report").into_iter().collect(),
        _ => Vec::new(),
    };
    candidates
        .into_iter()
        .take(10)
        .filter_map(violation_from)
        .collect()
}

pub fn process_csp_report(limiter: &IntakeLimiter, ip: Option<IpAddr>, body: &[u8]) -> StatusCode {
    if let Err(status) = admit(limiter, ip, body) {
        return status;
    }
    for violation in parse_csp_reports(body) {
        tracing::warn!(
            target: "csp",
            document = %violation.document,
            directive = %violation.directive,
            blocked = %violation.blocked,
            disposition = %violation.disposition,
            "csp violation"
        );
    }
    StatusCode::NO_CONTENT
}

pub async fn csp_report_handler(State(state): State<SharedState>, request: Request) -> Response {
    let ip = client_ip(&request, state.config.trust_proxy_headers);
    match read_body(request).await {
        Ok(body) => process_csp_report(&state.intake_limiter, ip, &body).into_response(),
        Err(status) => status.into_response(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Duration;

    fn ip(last: u8) -> IpAddr {
        IpAddr::from([10, 0, 0, last])
    }

    #[test]
    fn sanitize_strips_control_characters_and_caps_length() {
        assert_eq!(
            sanitize_text("ok\nFAKE LOG LINE\r\u{1b}[31m", 200),
            "okFAKE LOG LINE[31m"
        );
        assert_eq!(sanitize_text(&"a".repeat(500), 10).len(), 10);
        assert_eq!(sanitize_text("  padded  ", 50), "padded");
    }

    #[test]
    fn urls_never_keep_query_strings_or_fragments() {
        assert_eq!(
            path_only("https://app.example.com/app/fleet?token=secret#frag"),
            "/app/fleet"
        );
        assert_eq!(path_only("/app/policy?x=1"), "/app/policy");
        assert_eq!(path_only("https://app.example.com"), "/");
        assert_eq!(
            origin_only("https://cdn.example.com/a/b.js?key=secret"),
            "https://cdn.example.com"
        );
        assert_eq!(origin_only("inline"), "inline");
        assert_eq!(origin_only("data:image/png;base64,AAAA"), "data");
    }

    #[test]
    fn metrics_are_whitelisted_and_bounded() {
        let metrics = vec![
            VitalMetric {
                name: "LCP".into(),
                value: 1234.5678,
                rating: Some("good".into()),
            },
            VitalMetric {
                name: "CLS".into(),
                value: f64::NAN,
                rating: None,
            },
            VitalMetric {
                name: "INP".into(),
                value: -4.0,
                rating: None,
            },
            VitalMetric {
                name: "TTFB".into(),
                value: 9.0e9,
                rating: None,
            },
            VitalMetric {
                name: "evil\nname".into(),
                value: 1.0,
                rating: None,
            },
            VitalMetric {
                name: "FCP".into(),
                value: 800.0,
                rating: Some("whatever".into()),
            },
        ];
        let clean = clean_metrics(&metrics);
        assert_eq!(
            clean,
            vec![
                CleanMetric {
                    name: "LCP",
                    value: 1234.568,
                    rating: "good"
                },
                CleanMetric {
                    name: "FCP",
                    value: 800.0,
                    rating: "unrated"
                },
            ]
        );
    }

    #[test]
    fn metric_count_is_capped() {
        let metrics: Vec<VitalMetric> = (0..100)
            .map(|_| VitalMetric {
                name: "LCP".into(),
                value: 1.0,
                rating: None,
            })
            .collect();
        assert_eq!(clean_metrics(&metrics).len(), MAX_METRICS);
    }

    #[test]
    fn csp_reports_parse_in_both_formats_and_drop_secrets() {
        let legacy = br#"{"csp-report":{"document-uri":"https://app.example.com/app?token=abc","violated-directive":"script-src-elem","effective-directive":"script-src-elem","blocked-uri":"https://evil.example.net/x.js?k=1","disposition":"report"}}"#;
        let parsed = parse_csp_reports(legacy);
        assert_eq!(
            parsed,
            vec![CspViolation {
                document: "/app".into(),
                directive: "script-src-elem".into(),
                blocked: "https://evil.example.net".into(),
                disposition: "report".into(),
            }]
        );

        let modern = br#"[{"type":"csp-violation","body":{"documentURL":"https://app.example.com/","effectiveDirective":"img-src","blockedURL":"inline","disposition":"enforce"}},{"type":"deprecation","body":{}}]"#;
        let parsed = parse_csp_reports(modern);
        assert_eq!(parsed.len(), 1);
        assert_eq!(parsed[0].directive, "img-src");
        assert_eq!(parsed[0].blocked, "inline");
    }

    #[test]
    fn malformed_csp_reports_yield_nothing() {
        assert!(parse_csp_reports(b"not json").is_empty());
        assert!(parse_csp_reports(b"42").is_empty());
        assert!(parse_csp_reports(br#"{"csp-report":{}}"#).is_empty());
    }

    #[test]
    fn limiter_allows_a_burst_then_throttles_and_refills() {
        let limiter = IntakeLimiter::new(3, 60, 100);
        let start = Instant::now();
        assert!(limiter.allow_at(ip(1), start));
        assert!(limiter.allow_at(ip(1), start));
        assert!(limiter.allow_at(ip(1), start));
        assert!(!limiter.allow_at(ip(1), start));
        // A different client has its own bucket.
        assert!(limiter.allow_at(ip(2), start));
        // 60/minute refills one token per second.
        assert!(limiter.allow_at(ip(1), start + Duration::from_millis(1100)));
        assert!(!limiter.allow_at(ip(1), start + Duration::from_millis(1100)));
    }

    #[test]
    fn limiter_memory_is_bounded() {
        let limiter = IntakeLimiter::new(1, 1, 5);
        let start = Instant::now();
        for last in 0..50u8 {
            limiter.allow_at(ip(last), start + Duration::from_millis(u64::from(last)));
        }
        assert!(limiter.tracked_clients() <= 5);
    }

    #[test]
    fn vitals_endpoint_logic_maps_inputs_to_statuses() {
        let limiter = IntakeLimiter::new(100, 60, 100);
        let ok = br#"{"page":"/app/fleet?x=1","release":"1.2.3","metrics":[{"name":"LCP","value":1200,"rating":"good"}],"errors":[{"kind":"error","message":"boom"}]}"#;
        assert_eq!(
            process_web_vitals(&limiter, Some(ip(1)), ok),
            StatusCode::NO_CONTENT
        );
        assert_eq!(
            process_web_vitals(&limiter, Some(ip(1)), b"{"),
            StatusCode::BAD_REQUEST
        );
        assert_eq!(
            process_web_vitals(&limiter, Some(ip(1)), b"{\"metrics\":[]}"),
            StatusCode::BAD_REQUEST
        );
        let oversized = vec![b' '; MAX_BODY_BYTES + 1];
        assert_eq!(
            process_web_vitals(&limiter, Some(ip(1)), &oversized),
            StatusCode::PAYLOAD_TOO_LARGE
        );
    }

    #[test]
    fn intake_endpoints_throttle_one_client_without_affecting_another() {
        let limiter = IntakeLimiter::new(2, 1, 100);
        let ok = br#"{"page":"/","metrics":[]}"#;
        assert_eq!(
            process_web_vitals(&limiter, Some(ip(7)), ok),
            StatusCode::NO_CONTENT
        );
        assert_eq!(
            process_csp_report(&limiter, Some(ip(7)), b"{}"),
            StatusCode::NO_CONTENT
        );
        assert_eq!(
            process_web_vitals(&limiter, Some(ip(7)), ok),
            StatusCode::TOO_MANY_REQUESTS
        );
        assert_eq!(
            process_web_vitals(&limiter, Some(ip(8)), ok),
            StatusCode::NO_CONTENT
        );
        // An unresolvable client still gets a (shared) bucket rather than bypassing the limiter.
        assert_eq!(
            process_csp_report(&limiter, None, b"{}"),
            StatusCode::NO_CONTENT
        );
    }
}
