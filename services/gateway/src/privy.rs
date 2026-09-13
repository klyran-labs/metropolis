use axum::http::{HeaderMap, StatusCode};
use base64::engine::general_purpose::{URL_SAFE, URL_SAFE_NO_PAD};
use base64::Engine;
use reqwest::Client;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tracing::{error, info};

use crate::config::Config;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct JwtPayload {
    pub sub: Option<String>,
    pub iss: Option<String>,
    pub aud: Option<Value>,
    pub exp: Option<u64>,
    pub custom_metadata: Option<Value>,
}

#[derive(Debug, Clone)]
#[allow(dead_code)]
pub struct CallerAuth {
    pub did: String,
    pub is_super_admin: bool,
    pub role: Option<String>,
}

/// Decodes an unverified JWT payload (payload segment) to extract claims
pub fn decode_jwt_payload(token: &str) -> Option<JwtPayload> {
    let parts: Vec<&str> = token.split('.').collect();
    if parts.len() != 3 {
        return None;
    }

    let payload_b64 = parts[1];
    let decoded_bytes = URL_SAFE_NO_PAD
        .decode(payload_b64)
        .or_else(|_| URL_SAFE.decode(payload_b64))
        .ok()?;

    serde_json::from_slice::<JwtPayload>(&decoded_bytes).ok()
}

/// Authenticates the incoming request against Super Admin credentials or Privy JWT
pub fn authenticate_caller(headers: &HeaderMap, config: &Config) -> Result<CallerAuth, (StatusCode, String)> {
    // 1. Check for X-Admin-Secret header
    if let Some(admin_secret_header) = headers.get("x-admin-secret") {
        if let Ok(secret) = admin_secret_header.to_str() {
            if let Some(ref expected_secret) = config.privy_app_secret {
                if secret == expected_secret && !expected_secret.is_empty() {
                    return Ok(CallerAuth {
                        did: "system:admin-secret".to_string(),
                        is_super_admin: true,
                        role: Some("super_admin".to_string()),
                    });
                }
            }
        }
    }

    // 2. Check for Privy JWT (in privy-id-token or Authorization: Bearer <jwt>)
    let mut token_opt: Option<&str> = None;
    if let Some(privy_hdr) = headers.get("privy-id-token") {
        if let Ok(t) = privy_hdr.to_str() {
            token_opt = Some(t.trim());
        }
    }

    if token_opt.is_none() {
        if let Some(auth_hdr) = headers.get("authorization") {
            if let Ok(auth_val) = auth_hdr.to_str() {
                if let Some(stripped) = auth_val.strip_prefix("Bearer ") {
                    token_opt = Some(stripped.trim());
                }
            }
        }
    }

    if let Some(token) = token_opt {
        if let Some(payload) = decode_jwt_payload(token) {
            let did = payload.sub.unwrap_or_default();

            // Extract role from custom_metadata
            let role_from_meta = payload
                .custom_metadata
                .as_ref()
                .and_then(|m| m.get("role"))
                .and_then(|r| r.as_str())
                .map(|s| s.to_string());

            let is_in_initial_allowlist = !did.is_empty() && config.initial_super_admin_dids.contains(&did);
            let is_super_admin = is_in_initial_allowlist || role_from_meta.as_deref() == Some("super_admin");

            return Ok(CallerAuth {
                did,
                is_super_admin,
                role: role_from_meta,
            });
        }
    }

    // 3. Check for X-Caller-DID in dev / testing mode if no secret or token
    if let Some(caller_did_hdr) = headers.get("x-caller-did") {
        if let Ok(caller_did) = caller_did_hdr.to_str() {
            let did = caller_did.trim().to_string();
            let is_super_admin = config.initial_super_admin_dids.contains(&did);
            if is_super_admin {
                return Ok(CallerAuth {
                    did,
                    is_super_admin: true,
                    role: Some("super_admin".to_string()),
                });
            }
        }
    }

    Err((
        StatusCode::UNAUTHORIZED,
        "Authentication required. Provide valid 'privy-id-token' or 'x-admin-secret' header."
            .to_string(),
    ))
}

fn percent_encode(s: &str) -> String {
    let mut out = String::with_capacity(s.len() * 3);
    for b in s.bytes() {
        match b {
            b'a'..=b'z' | b'A'..=b'Z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                out.push(b as char);
            }
            _ => {
                use std::fmt::Write;
                let _ = write!(out, "%{:02X}", b);
            }
        }
    }
    out
}

/// Dispatches an HTTPS request to the Privy Server API to update user custom_metadata
pub async fn update_privy_custom_metadata(
    client: &Client,
    config: &Config,
    target_did: &str,
    new_role: &str,
    permissions: Option<&Value>,
    updated_by: &str,
) -> Result<Value, (StatusCode, String)> {
    let app_secret = config.privy_app_secret.as_ref().ok_or_else(|| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            "PRIVY_APP_SECRET is not configured on gateway.".to_string(),
        )
    })?;

    use base64::engine::general_purpose::STANDARD as BASE64;
    let basic_auth_raw = format!("{}:{}", config.privy_app_id, app_secret);
    let basic_auth = BASE64.encode(basic_auth_raw.as_bytes());

    let endpoint = format!(
        "https://auth.privy.io/api/v1/users/{}/custom_metadata",
        percent_encode(target_did)
    );

    let mut metadata_obj = serde_json::json!({
        "role": new_role,
        "updatedAt": chrono::Utc::now().to_rfc3339(),
        "updatedBy": updated_by,
    });

    if let Some(perms) = permissions {
        if let Some(obj) = metadata_obj.as_object_mut() {
            obj.insert("permissions".to_string(), perms.clone());
        }
    }

    let payload = serde_json::json!({
        "custom_metadata": metadata_obj
    });

    info!(
        "Calling Privy API to update role for DID: {} to {}",
        target_did, new_role
    );

    let response = client
        .post(&endpoint)
        .header("Authorization", format!("Basic {}", basic_auth))
        .header("privy-app-id", &config.privy_app_id)
        .header("Content-Type", "application/json")
        .json(&payload)
        .send()
        .await
        .map_err(|e| {
            error!("Privy Server API request failed: {}", e);
            (
                StatusCode::BAD_GATEWAY,
                format!("Failed to reach Privy Server API: {}", e),
            )
        })?;

    let status = response.status();
    let body_text = response.text().await.unwrap_or_default();

    if !status.is_success() {
        error!(
            "Privy API error {}: {}",
            status, body_text
        );
        return Err((
            StatusCode::from_u16(status.as_u16()).unwrap_or(StatusCode::BAD_GATEWAY),
            format!("Privy API returned status {}: {}", status, body_text),
        ));
    }

    let parsed: Value = serde_json::from_str(&body_text).unwrap_or(payload);
    Ok(parsed)
}

/// Dispatches an HTTPS request to the Privy Server API to fetch user details
pub async fn get_privy_user(
    client: &Client,
    config: &Config,
    target_did: &str,
) -> Result<Value, (StatusCode, String)> {
    let app_secret = config.privy_app_secret.as_ref().ok_or_else(|| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            "PRIVY_APP_SECRET is not configured on gateway.".to_string(),
        )
    })?;

    use base64::engine::general_purpose::STANDARD as BASE64;
    let basic_auth_raw = format!("{}:{}", config.privy_app_id, app_secret);
    let basic_auth = BASE64.encode(basic_auth_raw.as_bytes());

    let endpoint = format!(
        "https://auth.privy.io/api/v1/users/{}",
        percent_encode(target_did)
    );

    let response = client
        .get(&endpoint)
        .header("Authorization", format!("Basic {}", basic_auth))
        .header("privy-app-id", &config.privy_app_id)
        .header("Content-Type", "application/json")
        .send()
        .await
        .map_err(|e| {
            (
                StatusCode::BAD_GATEWAY,
                format!("Failed to reach Privy Server API: {}", e),
            )
        })?;

    let status = response.status();
    let body_text = response.text().await.unwrap_or_default();

    if !status.is_success() {
        return Err((
            StatusCode::from_u16(status.as_u16()).unwrap_or(StatusCode::BAD_GATEWAY),
            format!("Privy API error {}: {}", status, body_text),
        ));
    }

    serde_json::from_str::<Value>(&body_text).map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("Failed to parse Privy response JSON: {}", e),
        )
    })
}
