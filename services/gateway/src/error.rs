use axum::{
    Json,
    http::StatusCode,
    response::{IntoResponse, Response},
};
use serde::Serialize;

/// Stable machine-readable access and service failures. These codes are
/// intentionally separate from the onchain PolicyEngine reason-code enum.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AccessReasonCode {
    Unauthenticated,
    RoleForbidden,
    TenantScope,
    PolicyDenied,
    MfaRequired,
    IpNotAllowed,
    ApprovalRequired,
    EnvironmentDenied,
    ApiKeyRevoked,
    ConfigurationInvalid,
    DependencyUnavailable,
    RateLimited,
    InvalidRequest,
}

impl AccessReasonCode {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Unauthenticated => "ERR_UNAUTHENTICATED",
            Self::RoleForbidden => "ERR_ROLE_FORBIDDEN",
            Self::TenantScope => "ERR_TENANT_SCOPE",
            Self::PolicyDenied => "ERR_POLICY_DENIED",
            Self::MfaRequired => "ERR_MFA_REQUIRED",
            Self::IpNotAllowed => "ERR_IP_NOT_ALLOWED",
            Self::ApprovalRequired => "ERR_APPROVAL_REQUIRED",
            Self::EnvironmentDenied => "ERR_ENVIRONMENT_DENIED",
            Self::ApiKeyRevoked => "ERR_API_KEY_REVOKED",
            Self::ConfigurationInvalid => "ERR_CONFIGURATION_INVALID",
            Self::DependencyUnavailable => "ERR_DEPENDENCY_UNAVAILABLE",
            Self::RateLimited => "ERR_RATE_LIMITED",
            Self::InvalidRequest => "ERR_INVALID_REQUEST",
        }
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct ErrorBody {
    pub error: String,
    #[serde(rename = "reasonCode")]
    pub reason_code: String,
    pub message: String,
    pub remediation: String,
    #[serde(rename = "requestId")]
    pub request_id: String,
}

#[derive(Debug, Clone)]
pub struct ApiError {
    pub status: StatusCode,
    pub reason_code: AccessReasonCode,
    pub message: &'static str,
    pub remediation: &'static str,
    pub request_id: String,
}

impl ApiError {
    pub fn new(
        status: StatusCode,
        reason_code: AccessReasonCode,
        message: &'static str,
        remediation: &'static str,
    ) -> Self {
        Self {
            status,
            reason_code,
            message,
            remediation,
            request_id: uuid::Uuid::now_v7().to_string(),
        }
    }

    pub fn body(&self) -> ErrorBody {
        ErrorBody {
            error: self.reason_code.as_str().to_string(),
            reason_code: self.reason_code.as_str().to_string(),
            message: self.message.to_string(),
            remediation: self.remediation.to_string(),
            request_id: self.request_id.clone(),
        }
    }
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        let mut response = (self.status, Json(self.body())).into_response();
        response.headers_mut().insert(
            "x-agentguard-reason-code",
            self.reason_code
                .as_str()
                .parse()
                .expect("valid header value"),
        );
        response.headers_mut().insert(
            "x-request-id",
            self.request_id.parse().expect("valid header value"),
        );
        response
    }
}
