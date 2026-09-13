use alloy::sol;
use serde::{Deserialize, Serialize};

// Compile-time Solidity bindings using Alloy
sol! {
    #[derive(Debug, Serialize, Deserialize)]
    struct SpendRequest {
        address agent;
        address merchant;
        uint256 amount;
        bytes32 category;
        uint256 timestamp;
        uint256 deadline;
        uint64 nonce;
    }

    #[derive(Debug, Serialize, Deserialize)]
    struct PolicyDecision {
        bool allowed;
        uint256 allowedAmount;
        uint8 reasonCode;
        uint256 evaluatedAtTimestamp;
    }

    #[sol(rpc)]
    interface IPolicyEngine {
        function evaluate(SpendRequest calldata req) external view returns (bool allowed, uint256 allowedAmount, uint8 reasonCode, uint256 evaluatedAtTimestamp);
    }

    #[sol(rpc)]
    interface IAgentWalletGuard {
        function executeGatedPayment(
            SpendRequest calldata req,
            bytes calldata signature,
            address token,
            bytes calldata data
        ) external;
    }
}

/// Authoritative Reason Codes conforming strictly to Solidity Invariant #4
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[repr(u8)]
pub enum ReasonCode {
    None = 0,
    KillSwitch = 1,
    ExceedsMaxPerTx = 2,
    ExceedsMaxPerWindow = 3,
    VelocityExceeded = 4,
    MerchantNotWhitelisted = 5,
    BudgetDepleted = 6,
    Uncalibrated = 7,
    Expired = 8,
    SignatureInvalid = 9,
    Custom = 10,
}

impl ReasonCode {
    pub fn from_u8(code: u8) -> Self {
        match code {
            0 => ReasonCode::None,
            1 => ReasonCode::KillSwitch,
            2 => ReasonCode::ExceedsMaxPerTx,
            3 => ReasonCode::ExceedsMaxPerWindow,
            4 => ReasonCode::VelocityExceeded,
            5 => ReasonCode::MerchantNotWhitelisted,
            6 => ReasonCode::BudgetDepleted,
            7 => ReasonCode::Uncalibrated,
            8 => ReasonCode::Expired,
            9 => ReasonCode::SignatureInvalid,
            _ => ReasonCode::Custom,
        }
    }

    pub fn as_u8(&self) -> u8 {
        *self as u8
    }

    pub fn as_str(&self) -> &'static str {
        match self {
            ReasonCode::None => "ERR_NONE",
            ReasonCode::KillSwitch => "ERR_KILL_SWITCH",
            ReasonCode::ExceedsMaxPerTx => "ERR_EXCEEDS_MAX_PER_TX",
            ReasonCode::ExceedsMaxPerWindow => "ERR_EXCEEDS_MAX_PER_WINDOW",
            ReasonCode::VelocityExceeded => "ERR_VELOCITY_EXCEEDED",
            ReasonCode::MerchantNotWhitelisted => "ERR_MERCHANT_NOT_WHITELISTED",
            ReasonCode::BudgetDepleted => "ERR_BUDGET_DEPLETED",
            ReasonCode::Uncalibrated => "ERR_UNCALIBRATED",
            ReasonCode::Expired => "ERR_EXPIRED",
            ReasonCode::SignatureInvalid => "ERR_SIGNATURE_INVALID",
            ReasonCode::Custom => "ERR_CUSTOM",
        }
    }

    pub fn message(&self) -> &'static str {
        match self {
            ReasonCode::None => "Transaction conforms to all onchain policies.",
            ReasonCode::KillSwitch => "Agent emergency kill switch is active on Monad.",
            ReasonCode::ExceedsMaxPerTx => "Transaction amount exceeds configured per-transaction ceiling.",
            ReasonCode::ExceedsMaxPerWindow => "Aggregated spend exceeds sliding window maximum cap.",
            ReasonCode::VelocityExceeded => "Transaction velocity exceeded maximum allowed count within window.",
            ReasonCode::MerchantNotWhitelisted => "Target merchant address is not in agent whitelist.",
            ReasonCode::BudgetDepleted => "Hierarchical shared organization budget pool exhausted.",
            ReasonCode::Uncalibrated => "Agent spend policy has not been provisioned onchain.",
            ReasonCode::Expired => "Spend request signature deadline has passed.",
            ReasonCode::SignatureInvalid => "Cryptographic EIP-712 signature verification failed on Monad.",
            ReasonCode::Custom => "Custom policy verification denial.",
        }
    }

    pub fn remediation(&self) -> &'static str {
        match self {
            ReasonCode::None => "None required.",
            ReasonCode::KillSwitch => "Contact SecOps to disarm the kill switch after threat remediation.",
            ReasonCode::ExceedsMaxPerTx => "Reduce single transaction amount or request policy limit increase.",
            ReasonCode::ExceedsMaxPerWindow => "Wait for sliding window duration to reset or request window increase.",
            ReasonCode::VelocityExceeded => "Throttle transaction dispatch frequency to stay within rate limit.",
            ReasonCode::MerchantNotWhitelisted => "Submit merchant address to SecOps for inclusion in whitelist.",
            ReasonCode::BudgetDepleted => "Request Treasury Manager to top up or reallocate shared budget pool.",
            ReasonCode::Uncalibrated => "Initialize spend policy via PolicyStudio before issuing transactions.",
            ReasonCode::Expired => "Re-sign spend request with a refreshed timestamp and valid deadline.",
            ReasonCode::SignatureInvalid => "Verify agent private key and EIP-712 domain separator parameters.",
            ReasonCode::Custom => "Review custom contract assertion conditions.",
        }
    }
}

// ----------------------------------------------------------------------------
// x402 HTTP 402 / 403 Protocol Wire Types
// ----------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct X402Challenge {
    pub standard: String,
    pub version: String,
    pub network: String,
    #[serde(rename = "chainId")]
    pub chain_id: u64,
    pub challenge: X402ChallengeDetails,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct X402ChallengeDetails {
    #[serde(rename = "payTo")]
    pub pay_to: String,
    #[serde(rename = "amountWei")]
    pub amount_wei: String,
    pub token: String,
    #[serde(rename = "serviceId")]
    pub service_id: String,
    pub category: String,
    pub description: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SpendRequestWire {
    pub agent: String,
    pub merchant: String,
    pub amount: String,
    pub category: String,
    pub timestamp: String,
    pub deadline: String,
    pub nonce: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct X402AuthorizationPayload {
    pub request: SpendRequestWire,
    pub signature: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct X402PolicyRejectionBody {
    pub error: String,
    #[serde(rename = "reasonCode")]
    pub reason_code: u8,
    pub message: String,
    pub remediation: String,
    pub agent: String,
    pub network: String,
    #[serde(rename = "chainId")]
    pub chain_id: u64,
    #[serde(rename = "evaluatedAt")]
    pub evaluated_at: String,
}

// ----------------------------------------------------------------------------
// Privy Role Administration Wire Types
// ----------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpdateRoleRequest {
    pub role: String,
    pub permissions: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RoleResponse {
    pub success: bool,
    pub did: String,
    pub role: String,
    pub custom_metadata: serde_json::Value,
    #[serde(rename = "updatedAt")]
    pub updated_at: String,
}
