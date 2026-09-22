use crate::{
    config::Config,
    error::{AccessReasonCode, ApiError},
    rbac::{PlatformRole, Role},
    repository::PgRepository,
    tenant::TenantContext,
};
use alloy::primitives::Address;
use axum::http::{HeaderMap, Request, StatusCode, header};
use chrono::Utc;
use jsonwebtoken::{Algorithm, DecodingKey, TokenData, Validation, decode, decode_header};
use reqwest::Client;
use serde::Deserialize;
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::{
    net::{IpAddr, SocketAddr},
    sync::Arc,
    time::{Duration, Instant},
};
use tokio::sync::{Mutex, RwLock};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum IdentityKind {
    Privy,
    ApiKey,
}

#[derive(Debug, Clone)]
pub struct RequestContext {
    pub subject: String,
    pub role: Role,
    pub platform_role: Option<PlatformRole>,
    pub tenant: TenantContext,
    pub mfa_authenticated: bool,
    pub identity_kind: IdentityKind,
    pub api_key_id: Option<uuid::Uuid>,
    pub capabilities: Vec<String>,
    pub client_ip: Option<IpAddr>,
}

#[derive(Debug, Clone)]
pub struct OnboardingIdentity {
    pub subject: String,
    pub client_ip: Option<IpAddr>,
}

#[derive(Debug, Clone)]
pub struct ApiKeyIdentity {
    pub id: uuid::Uuid,
    pub org_id: String,
    pub subject: String,
    pub agent: Address,
    pub capabilities: Vec<String>,
}

#[derive(Debug, Clone)]
pub struct OperatorIdentity {
    pub role: String,
    pub mfa_authenticated: bool,
    pub enterprise_address: Address,
}

#[derive(Debug, Clone, Deserialize)]
struct PrivyClaims {
    sub: String,
    iss: String,
    aud: Audience,
    exp: usize,
    #[serde(default)]
    nbf: Option<usize>,
    #[serde(default)]
    custom_metadata: Value,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(untagged)]
enum Audience {
    One(String),
    Many(Vec<String>),
}

impl Audience {
    fn contains(&self, value: &str) -> bool {
        match self {
            Self::One(item) => item == value,
            Self::Many(items) => items.iter().any(|item| item == value),
        }
    }
}

#[derive(Debug, Clone, Deserialize)]
struct JwksResponse {
    keys: Vec<JsonWebKey>,
}

#[derive(Debug, Clone, Deserialize)]
struct JsonWebKey {
    kid: String,
    kty: String,
    alg: Option<String>,
    n: Option<String>,
    e: Option<String>,
    crv: Option<String>,
    x: Option<String>,
    y: Option<String>,
}

#[derive(Debug, Clone)]
struct CachedJwks {
    expires_at: Instant,
    keys: Vec<JsonWebKey>,
}

#[derive(Clone)]
pub struct AuthService {
    config: Config,
    client: Client,
    repository: PgRepository,
    jwks: Arc<RwLock<Option<CachedJwks>>>,
    jwks_refresh: Arc<Mutex<()>>,
}

impl AuthService {
    pub fn new(config: Config, client: Client, repository: PgRepository) -> Self {
        Self {
            config,
            client,
            repository,
            jwks: Arc::new(RwLock::new(None)),
            jwks_refresh: Arc::new(Mutex::new(())),
        }
    }

    pub async fn authenticate(
        &self,
        headers: &HeaderMap,
        client_ip: Option<IpAddr>,
    ) -> Result<RequestContext, ApiError> {
        let token = bearer_token(headers)?;

        if token.starts_with("ag_live_sec_") {
            return self.authenticate_api_key(token, client_ip).await;
        }

        self.authenticate_privy(token, client_ip).await
    }

    pub async fn authenticate_onboarding(
        &self,
        headers: &HeaderMap,
        client_ip: Option<IpAddr>,
    ) -> Result<OnboardingIdentity, ApiError> {
        let token = bearer_token(headers)?;
        if token.starts_with("ag_live_sec_") {
            return Err(ApiError::new(
                StatusCode::FORBIDDEN,
                AccessReasonCode::TenantScope,
                "Machine credentials cannot create organizations.",
                "Sign in with a verified human identity to create an organization.",
            ));
        }
        let claims = self.verify_privy_claims(token).await?;
        let org_hint = claims
            .custom_metadata
            .as_object()
            .and_then(|metadata| metadata.get("orgId"))
            .and_then(Value::as_str);
        let already_member = self
            .repository
            .load_operator_for_subject(&claims.sub, org_hint)
            .await
            .map_err(|_| {
                ApiError::new(
                    StatusCode::SERVICE_UNAVAILABLE,
                    AccessReasonCode::DependencyUnavailable,
                    "Identity services are temporarily unavailable.",
                    "Retry after the identity store is healthy.",
                )
            })?
            .is_some();
        if already_member {
            return Err(ApiError::new(
                StatusCode::CONFLICT,
                AccessReasonCode::TenantScope,
                "This identity already belongs to an organization.",
                "Open the existing organization workspace.",
            ));
        }
        Ok(OnboardingIdentity {
            subject: claims.sub,
            client_ip,
        })
    }

    async fn authenticate_api_key(
        &self,
        token: &str,
        client_ip: Option<IpAddr>,
    ) -> Result<RequestContext, ApiError> {
        let key_prefix = token.get(..16).ok_or_else(|| {
            ApiError::new(
                StatusCode::UNAUTHORIZED,
                AccessReasonCode::Unauthenticated,
                "The machine credential is invalid.",
                "Provision a valid machine credential.",
            )
        })?;
        let key_hash = Sha256::digest(token.as_bytes());
        let identity = self
            .repository
            .load_api_key(key_prefix, &key_hash)
            .await
            .map_err(|_| {
                ApiError::new(
                    StatusCode::SERVICE_UNAVAILABLE,
                    AccessReasonCode::DependencyUnavailable,
                    "Identity services are temporarily unavailable.",
                    "Retry after the identity store is healthy.",
                )
            })?
            .ok_or_else(|| {
                ApiError::new(
                    StatusCode::UNAUTHORIZED,
                    AccessReasonCode::ApiKeyRevoked,
                    "The machine credential is invalid or revoked.",
                    "Provision a new credential with the required scope.",
                )
            })?;

        Ok(RequestContext {
            subject: identity.subject,
            role: Role::AgentDeveloper,
            platform_role: None,
            tenant: TenantContext {
                org_id: identity.org_id,
                enterprise_address: identity.agent,
            },
            mfa_authenticated: false,
            identity_kind: IdentityKind::ApiKey,
            api_key_id: Some(identity.id),
            capabilities: identity.capabilities,
            client_ip,
        })
    }

    async fn authenticate_privy(
        &self,
        token: &str,
        client_ip: Option<IpAddr>,
    ) -> Result<RequestContext, ApiError> {
        let claims = self.verify_privy_claims(token).await?;

        // Privy custom metadata may contain an organization hint for routing,
        // but it is never trusted for role, tenant membership, enterprise
        // address, or MFA. PostgreSQL is the authorization source of truth.
        let org_hint = claims
            .custom_metadata
            .as_object()
            .and_then(|metadata| metadata.get("orgId"))
            .and_then(Value::as_str);
        let (org_id, identity) = self
            .repository
            .load_operator_for_subject(&claims.sub, org_hint)
            .await
            .map_err(|_| {
                ApiError::new(
                    StatusCode::SERVICE_UNAVAILABLE,
                    AccessReasonCode::DependencyUnavailable,
                    "Identity services are temporarily unavailable.",
                    "Retry after the identity store is healthy.",
                )
            })?
            .ok_or_else(|| {
                ApiError::new(
                    StatusCode::FORBIDDEN,
                    AccessReasonCode::TenantScope,
                    "The operator has no unambiguous active organization membership.",
                    "Ask an organization administrator to provision one active tenant membership.",
                )
            })?;
        let role = Role::parse(&identity.role).ok_or_else(|| {
            ApiError::new(
                StatusCode::INTERNAL_SERVER_ERROR,
                AccessReasonCode::ConfigurationInvalid,
                "The organization role record is invalid.",
                "Repair the role record before continuing.",
            )
        })?;
        let platform_role = self
            .repository
            .load_platform_role(&claims.sub)
            .await
            .map_err(|_| {
                ApiError::new(
                    StatusCode::SERVICE_UNAVAILABLE,
                    AccessReasonCode::DependencyUnavailable,
                    "Platform authorization services are temporarily unavailable.",
                    "Retry after the platform identity store is healthy.",
                )
            })?
            .and_then(|value| PlatformRole::parse(&value));

        Ok(RequestContext {
            subject: claims.sub,
            role,
            platform_role,
            tenant: TenantContext {
                org_id,
                enterprise_address: identity.enterprise_address,
            },
            mfa_authenticated: identity.mfa_authenticated,
            identity_kind: IdentityKind::Privy,
            api_key_id: None,
            capabilities: Vec::new(),
            client_ip,
        })
    }

    async fn verify_privy_claims(&self, token: &str) -> Result<PrivyClaims, ApiError> {
        let header = decode_header(token).map_err(|_| {
            ApiError::new(
                StatusCode::UNAUTHORIZED,
                AccessReasonCode::Unauthenticated,
                "The operator identity is invalid.",
                "Sign in again to obtain a valid identity token.",
            )
        })?;
        if header.alg != Algorithm::RS256 && header.alg != Algorithm::ES256 {
            return Err(ApiError::new(
                StatusCode::UNAUTHORIZED,
                AccessReasonCode::Unauthenticated,
                "The operator identity uses an unsupported signature algorithm.",
                "Obtain a Privy identity token signed with the configured algorithm.",
            ));
        }
        let kid = header.kid.ok_or_else(|| {
            ApiError::new(
                StatusCode::UNAUTHORIZED,
                AccessReasonCode::Unauthenticated,
                "The operator identity is missing a signing-key identifier.",
                "Sign in again to obtain a current identity token.",
            )
        })?;
        let key = self.jwk(&kid, header.alg).await?;
        let configuration_invalid = || {
            ApiError::new(
                StatusCode::SERVICE_UNAVAILABLE,
                AccessReasonCode::ConfigurationInvalid,
                "The identity verification configuration is invalid.",
                "Check the configured identity signing keys.",
            )
        };
        let decoding_key = match key.kty.as_str() {
            "EC" => {
                if key.crv.as_deref() != Some("P-256") {
                    return Err(configuration_invalid());
                }
                let (x, y) = key
                    .x
                    .as_deref()
                    .zip(key.y.as_deref())
                    .ok_or_else(configuration_invalid)?;
                DecodingKey::from_ec_components(x, y).map_err(|_| configuration_invalid())?
            }
            "RSA" => {
                let (n, e) = key
                    .n
                    .as_deref()
                    .zip(key.e.as_deref())
                    .ok_or_else(configuration_invalid)?;
                DecodingKey::from_rsa_components(n, e).map_err(|_| configuration_invalid())?
            }
            _ => return Err(configuration_invalid()),
        };
        let mut validation = Validation::new(header.alg);
        validation.set_audience(&[self.config.privy_app_id.as_str()]);
        validation.set_issuer(&[self.config.privy_issuer.as_str()]);
        validation.validate_exp = true;
        let TokenData { claims, .. } = decode::<PrivyClaims>(token, &decoding_key, &validation)
            .map_err(|_| {
                ApiError::new(
                    StatusCode::UNAUTHORIZED,
                    AccessReasonCode::Unauthenticated,
                    "The operator identity could not be verified.",
                    "Sign in again to obtain a valid identity token.",
                )
            })?;
        if claims.iss != self.config.privy_issuer
            || !claims.aud.contains(&self.config.privy_app_id)
            || claims.exp <= Utc::now().timestamp() as usize
            || claims
                .nbf
                .is_some_and(|nbf| nbf > Utc::now().timestamp() as usize)
        {
            return Err(ApiError::new(
                StatusCode::UNAUTHORIZED,
                AccessReasonCode::Unauthenticated,
                "The operator identity is not valid for this service.",
                "Obtain a fresh identity token for the configured application.",
            ));
        }
        Ok(claims)
    }

    async fn jwk(&self, kid: &str, alg: Algorithm) -> Result<JsonWebKey, ApiError> {
        let expected_kty = match alg {
            Algorithm::ES256 => "EC",
            _ => "RSA",
        };
        let expected_alg = match alg {
            Algorithm::ES256 => "ES256",
            _ => "RS256",
        };

        // Fast path: read lock — returns immediately for the overwhelming majority of requests.
        // No heap allocation, no network call.
        {
            let cache = self.jwks.read().await;
            if let Some(key) = cache
                .as_ref()
                .filter(|c| c.expires_at > Instant::now())
                .and_then(|c| {
                    c.keys
                        .iter()
                        .find(|k| k.kid == kid && k.kty == expected_kty)
                })
            {
                return Ok(key.clone());
            }
        } // read lock released here

        // Slow path: serialize refreshes with a dedicated async mutex, while keeping the JWKS
        // read/write lock free during network I/O. Authentication readers therefore do not queue
        // behind a slow or unavailable identity provider.
        let _refresh_guard = self.jwks_refresh.lock().await;
        {
            let cache = self.jwks.read().await;
            if let Some(key) = cache
                .as_ref()
                .filter(|c| c.expires_at > Instant::now())
                .and_then(|c| {
                    c.keys
                        .iter()
                        .find(|k| k.kid == kid && k.kty == expected_kty)
                })
            {
                return Ok(key.clone());
            }
        }

        // Network I/O deliberately occurs without holding the cache lock.
        let response = self
            .client
            .get(&self.config.privy_jwks_url)
            .send()
            .await
            .map_err(|_| {
                ApiError::new(
                    StatusCode::SERVICE_UNAVAILABLE,
                    AccessReasonCode::DependencyUnavailable,
                    "Identity signing keys are temporarily unavailable.",
                    "Retry after the identity provider is reachable.",
                )
            })?;
        let body = response.json::<JwksResponse>().await.map_err(|_| {
            ApiError::new(
                StatusCode::SERVICE_UNAVAILABLE,
                AccessReasonCode::DependencyUnavailable,
                "Identity signing keys could not be loaded.",
                "Retry after the identity provider returns valid signing keys.",
            )
        })?;
        let key = body
            .keys
            .iter()
            .find(|k| {
                k.kid == kid
                    && k.kty == expected_kty
                    && k.alg.as_deref().unwrap_or(expected_alg) == expected_alg
            })
            .cloned();

        // Proactive pre-expiry buffer: expire 30s early so foreground requests always hit a warm
        // cache. The background refresh cost (one HTTP GET) happens 30s before visible expiry.
        let effective_ttl = self.config.jwks_cache_seconds.saturating_sub(30);
        let mut cache = self.jwks.write().await;
        *cache = Some(CachedJwks {
            expires_at: Instant::now() + Duration::from_secs(effective_ttl),
            keys: body.keys,
        });

        key.ok_or_else(|| {
            ApiError::new(
                StatusCode::UNAUTHORIZED,
                AccessReasonCode::Unauthenticated,
                "The identity signing key is not recognized.",
                "Sign in again to obtain a token signed by an active key.",
            )
        })
    }
}

fn bearer_token(headers: &HeaderMap) -> Result<&str, ApiError> {
    let auth = headers
        .get(header::AUTHORIZATION)
        .and_then(|value| value.to_str().ok())
        .ok_or_else(|| {
            ApiError::new(
                StatusCode::UNAUTHORIZED,
                AccessReasonCode::Unauthenticated,
                "Authentication is required.",
                "Provide a valid operator identity or machine credential.",
            )
        })?;
    auth.strip_prefix("Bearer ")
        .map(str::trim)
        .filter(|token| !token.is_empty())
        .ok_or_else(|| {
            ApiError::new(
                StatusCode::UNAUTHORIZED,
                AccessReasonCode::Unauthenticated,
                "The authentication scheme is not supported.",
                "Use a Bearer credential.",
            )
        })
}

pub fn client_ip<B>(request: &Request<B>, trust_proxy_headers: bool) -> Option<IpAddr> {
    if trust_proxy_headers
        && let Some(value) = request
            .headers()
            .get("x-forwarded-for")
            .and_then(|value| value.to_str().ok())
        && let Some(ip) = value
            .split(',')
            .next()
            .and_then(|value| value.trim().parse().ok())
    {
        return Some(ip);
    }
    request
        .extensions()
        .get::<SocketAddr>()
        .map(|address| address.ip())
}
