use crate::{
    abac::AbacPolicy,
    pbac::{PbacConditions, PolicyEffect},
};
use alloy::sol;
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

sol! {
    #[derive(Debug, Serialize, Deserialize)]
    struct SpendRequest {
        address agent;
        address merchant;
        uint256 amount;
        bytes32 category;
        uint256 timestamp;
        uint256 deadline;
        uint256 nonce;
    }

    struct SpendPolicy {
        uint128 maxPerTx;
        uint128 maxPerWindow;
        uint32 windowSeconds;
        uint32 maxVelocity;
        bool killSwitch;
        bool whitelistEnabled;
    }

    #[sol(rpc)]
    interface IPolicyEngine {
        function setPolicy(address agent, SpendPolicy calldata policy) external;
        function evaluate(SpendRequest calldata req) external view returns (bool allowed, uint256 allowedAmount, uint8 reasonCode, uint256 evaluatedAtTimestamp);
        function evaluateAndSpend(SpendRequest calldata req) external returns (bool allowed, uint256 allowedAmount, uint8 reasonCode, uint256 evaluatedAtTimestamp);
        function getAgentPolicy(address agent) external view returns (uint128 maxPerTx, uint128 maxPerWindow, uint32 windowSeconds, uint32 maxVelocity, bool killSwitch, bool whitelistEnabled);
        function getAgentState(address agent) external view returns (uint128 spentInWindow, uint32 windowStart, uint32 txCountInWindow, uint64 nonce);
        function isMerchantWhitelisted(address agent, address merchant) external view returns (bool);
    }

    #[sol(rpc)]
    interface IERC20Balance {
        function balanceOf(address account) external view returns (uint256);
    }

    #[sol(rpc)]
    interface IERC1271 {
        function isValidSignature(bytes32 hash, bytes memory signature) external view returns (bytes4 magicValue);
    }

    #[sol(rpc)]
    interface IAgentWalletGuard {
        struct BatchPaymentItem {
            SpendRequest req;
            bytes signature;
            address token;
            bytes extraCallData;
        }

        function executeGatedPayment(
            SpendRequest calldata req,
            bytes calldata signature,
            address token,
            bytes calldata data
        ) external;

        function executeBatchGatedPayment(
            BatchPaymentItem[] calldata items
        ) external returns (bool[] memory successes);
    }

    #[sol(rpc)]
    interface ICircuitPaymaster {
        function isSponsorshipEligible(address agent, uint256 maxCost) external view returns (bool eligible, uint8 reasonCode);
    }
}

/// Canonical onchain reason codes from contracts/src/interfaces/IPolicyEngine.sol.
/// This enum must remain numerically identical to the Solidity interface.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[repr(u8)]
pub enum OnchainReasonCode {
    None = 0,
    KillSwitch = 1,
    MaxPerTx = 2,
    MaxPerWindow = 3,
    VelocityExceeded = 4,
    MerchantNotAllowed = 5,
    BudgetDepleted = 6,
    Expired = 7,
    NonceReused = 8,
    SignatureInvalid = 9,
}

impl OnchainReasonCode {
    pub fn from_u8(code: u8) -> Option<Self> {
        Some(match code {
            0 => Self::None,
            1 => Self::KillSwitch,
            2 => Self::MaxPerTx,
            3 => Self::MaxPerWindow,
            4 => Self::VelocityExceeded,
            5 => Self::MerchantNotAllowed,
            6 => Self::BudgetDepleted,
            7 => Self::Expired,
            8 => Self::NonceReused,
            9 => Self::SignatureInvalid,
            _ => return None,
        })
    }

    pub const fn as_u8(self) -> u8 {
        self as u8
    }

    pub const fn as_str(self) -> &'static str {
        match self {
            Self::None => "ERR_NONE",
            Self::KillSwitch => "ERR_KILL_SWITCH",
            Self::MaxPerTx => "ERR_MAX_PER_TX",
            Self::MaxPerWindow => "ERR_MAX_PER_WINDOW",
            Self::VelocityExceeded => "ERR_VELOCITY_EXCEEDED",
            Self::MerchantNotAllowed => "ERR_MERCHANT_NOT_ALLOWED",
            Self::BudgetDepleted => "ERR_BUDGET_DEPLETED",
            Self::Expired => "ERR_EXPIRED",
            Self::NonceReused => "ERR_NONCE_REUSED",
            Self::SignatureInvalid => "ERR_SIGNATURE_INVALID",
        }
    }

    pub const fn message(self) -> &'static str {
        match self {
            Self::None => "The spend request conforms to the onchain policy.",
            Self::KillSwitch => "The agent kill switch is active on Monad.",
            Self::MaxPerTx => "The transaction amount exceeds the configured ceiling.",
            Self::MaxPerWindow => "The rolling spend window is exhausted.",
            Self::VelocityExceeded => "The transaction velocity limit was exceeded.",
            Self::MerchantNotAllowed => "The merchant is not on the agent whitelist.",
            Self::BudgetDepleted => "The organization budget pool is exhausted.",
            Self::Expired => "The spend request deadline has passed.",
            Self::NonceReused => "The spend request nonce has already been consumed.",
            Self::SignatureInvalid => "The EIP-712 signature is invalid.",
        }
    }

    pub const fn remediation(self) -> &'static str {
        match self {
            Self::None => "None required.",
            Self::KillSwitch => "Contact SecOps after threat remediation.",
            Self::MaxPerTx => "Reduce the amount or request a policy change.",
            Self::MaxPerWindow => "Wait for the policy window to reset or request an increase.",
            Self::VelocityExceeded => "Throttle dispatch frequency.",
            Self::MerchantNotAllowed => "Request merchant authorization from an administrator.",
            Self::BudgetDepleted => "Request Treasury to replenish or reallocate the budget.",
            Self::Expired => "Sign a new request with a future deadline.",
            Self::NonceReused => "Create a new request with an unused nonce.",
            Self::SignatureInvalid => "Verify the agent key and EIP-712 domain.",
        }
    }
}

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

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpdateRoleRequest {
    pub role: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RoleResponse {
    pub success: bool,
    pub subject: String,
    pub org_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tenant_name: Option<String>,
    pub role: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PlanPriceInput {
    #[serde(rename = "chainId")]
    pub chain_id: u64,
    #[serde(rename = "tokenAddress")]
    pub token_address: String,
    #[serde(rename = "amountBaseUnits")]
    pub amount_base_units: String,
    pub interval: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreatePlanRequest {
    pub code: String,
    pub name: String,
    pub description: String,
    pub prices: Vec<PlanPriceInput>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PlanPriceResponse {
    pub id: Uuid,
    #[serde(rename = "chainId")]
    pub chain_id: u64,
    #[serde(rename = "tokenAddress")]
    pub token_address: String,
    #[serde(rename = "amountBaseUnits")]
    pub amount_base_units: String,
    pub interval: String,
    pub active: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PlanResponse {
    pub id: Uuid,
    pub code: String,
    pub name: String,
    pub description: String,
    pub active: bool,
    pub prices: Vec<PlanPriceResponse>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CheckoutRequest {
    #[serde(rename = "planPriceId")]
    pub plan_price_id: Uuid,
    pub agent: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PaymentSubmissionRequest {
    #[serde(rename = "transactionHash")]
    pub transaction_hash: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PolicyUpdateRequest {
    #[serde(rename = "maxPerTx")]
    pub max_per_tx: String,
    #[serde(rename = "maxPerWindow")]
    pub max_per_window: String,
    #[serde(rename = "windowSeconds")]
    pub window_seconds: u32,
    #[serde(rename = "maxVelocity")]
    pub max_velocity: u32,
    #[serde(rename = "killSwitch")]
    pub kill_switch: bool,
    #[serde(rename = "whitelistEnabled")]
    pub whitelist_enabled: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RegisterAgentRequest {
    /// Required when `walletSource` is "external" (or omitted); ignored for "sovereign".
    pub address: Option<String>,
    #[serde(rename = "adminAddress")]
    pub admin_address: Option<String>,
    pub environment: String,
    #[serde(rename = "riskTier")]
    pub risk_tier: String,
    /// "external" (default, caller-supplied address) or "sovereign" (OpenSigner-generated).
    #[serde(rename = "walletSource")]
    pub wallet_source: Option<String>,
    /// Label for the generated signing wallet; required when walletSource is "sovereign".
    pub label: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RegisterOrganizationWalletRequest {
    /// "external" (caller proves ownership of an existing address) or "sovereign"
    /// (OpenSigner-generated).
    pub kind: String,
    pub label: String,
    /// Required for "external".
    pub address: Option<String>,
    /// Ownership-proof signature over the tenant's org_id, required for "external".
    pub signature: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GrantWalletAccessRequest {
    pub subject: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpdateWalletThresholdRequest {
    #[serde(rename = "approvalThreshold")]
    pub approval_threshold: i16,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PrepareWalletTransferRequest {
    #[serde(rename = "organizationWalletId")]
    pub organization_wallet_id: Uuid,
    #[serde(rename = "amountBaseUnits")]
    pub amount_base_units: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SubmitWalletTransferRequest {
    #[serde(rename = "transactionHash")]
    pub transaction_hash: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateTenantRequest {
    #[serde(rename = "displayName")]
    pub display_name: String,
    #[serde(rename = "enterpriseAddress")]
    pub enterprise_address: String,
    #[serde(rename = "ownerSubject")]
    pub owner_subject: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateOnboardingTenantRequest {
    #[serde(rename = "displayName")]
    pub display_name: String,
    #[serde(rename = "enterpriseAddress")]
    pub enterprise_address: String,
    pub signature: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PlatformOperatorRequest {
    pub subject: String,
    pub role: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateSigningWalletRequest {
    pub label: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PaymasterRpcRequest {
    pub jsonrpc: String,
    pub id: serde_json::Value,
    pub method: String,
    pub params: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateApiKeyRequest {
    #[serde(rename = "agentAddress")]
    pub agent_address: String,
    pub subject: String,
    pub capabilities: Vec<String>,
    #[serde(rename = "expiresAt")]
    pub expires_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RotateApiKeyRequest {
    #[serde(rename = "expiresAt")]
    pub expires_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PbacPolicyRequest {
    #[serde(default)]
    pub id: Option<Uuid>,
    pub effect: PolicyEffect,
    #[serde(default)]
    pub principals: Vec<String>,
    #[serde(default)]
    pub actions: Vec<String>,
    #[serde(default)]
    pub resources: Vec<String>,
    #[serde(default)]
    pub conditions: PbacConditions,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AbacPolicyRequest {
    #[serde(flatten)]
    pub policy: AbacPolicy,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub enum PricingModelType {
    #[default]
    FlatDiscount,
    TieredVolume,
    CommittedPtu,
    BatchDiscount,
    PerUnitRequest,
    HybridCommitVolume,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VolumeTier {
    #[serde(rename = "minTokens")]
    pub min_tokens: u64,
    #[serde(rename = "discountBps")]
    pub discount_bps: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModelRateOverride {
    #[serde(rename = "inputPerMMicroDollars")]
    pub input_per_m_micro_dollars: u64,
    #[serde(rename = "outputPerMMicroDollars")]
    pub output_per_m_micro_dollars: u64,
    #[serde(
        rename = "cacheReadPerMMicroDollars",
        skip_serializing_if = "Option::is_none"
    )]
    pub cache_read_per_m_micro_dollars: Option<u64>,
    #[serde(
        rename = "cacheWritePerMMicroDollars",
        skip_serializing_if = "Option::is_none"
    )]
    pub cache_write_per_m_micro_dollars: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolRateOverride {
    #[serde(rename = "costPerCallMicroDollars")]
    pub cost_per_call_micro_dollars: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolCatalogEntry {
    #[serde(rename = "toolId")]
    pub tool_id: String,
    #[serde(rename = "displayName")]
    pub display_name: String,
    pub provider: String,
    pub category: String,
    #[serde(rename = "costPerCallMicroDollars")]
    pub cost_per_call_micro_dollars: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TenantPricingModel {
    #[serde(rename = "orgId")]
    pub org_id: String,
    #[serde(rename = "modelType")]
    pub model_type: PricingModelType,
    #[serde(rename = "discountBps")]
    pub discount_bps: u32,
    #[serde(rename = "volumeTiers")]
    pub volume_tiers: Vec<VolumeTier>,
    #[serde(rename = "ptuCapacityTokens")]
    pub ptu_capacity_tokens: u64,
    #[serde(rename = "tokenCapTokens", default)]
    pub token_cap_tokens: u64,
    #[serde(rename = "perCallFeeMicroDollars", default)]
    pub per_call_fee_micro_dollars: u64,
    #[serde(rename = "customRates")]
    pub custom_rates: std::collections::HashMap<String, ModelRateOverride>,
    #[serde(rename = "toolCustomRates", default)]
    pub tool_custom_rates: std::collections::HashMap<String, ToolRateOverride>,
    #[serde(rename = "monthlyTokensConsumed")]
    pub monthly_tokens_consumed: u64,
    #[serde(rename = "updatedAt")]
    pub updated_at: String,
}

impl Default for TenantPricingModel {
    fn default() -> Self {
        Self {
            org_id: String::new(),
            model_type: PricingModelType::FlatDiscount,
            discount_bps: 0,
            volume_tiers: vec![],
            ptu_capacity_tokens: 0,
            token_cap_tokens: 0,
            per_call_fee_micro_dollars: 0,
            custom_rates: std::collections::HashMap::new(),
            tool_custom_rates: std::collections::HashMap::new(),
            monthly_tokens_consumed: 0,
            updated_at: chrono::Utc::now().to_rfc3339(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpdatePricingModelRequest {
    #[serde(rename = "modelType")]
    pub model_type: PricingModelType,
    #[serde(rename = "discountBps", default)]
    pub discount_bps: u32,
    #[serde(rename = "volumeTiers", default)]
    pub volume_tiers: Vec<VolumeTier>,
    #[serde(rename = "ptuCapacityTokens", default)]
    pub ptu_capacity_tokens: u64,
    #[serde(rename = "tokenCapTokens", default)]
    pub token_cap_tokens: u64,
    #[serde(rename = "perCallFeeMicroDollars", default)]
    pub per_call_fee_micro_dollars: u64,
    #[serde(rename = "customRates", default)]
    pub custom_rates: std::collections::HashMap<String, ModelRateOverride>,
    #[serde(rename = "toolCustomRates", default)]
    pub tool_custom_rates: std::collections::HashMap<String, ToolRateOverride>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FinOpsSpendResult {
    #[serde(rename = "modelName")]
    pub model_name: String,
    #[serde(rename = "totalTokens")]
    pub total_tokens: u64,
    #[serde(rename = "inputTokens")]
    pub input_tokens: u64,
    #[serde(rename = "outputTokens")]
    pub output_tokens: u64,
    #[serde(rename = "cacheReadTokens")]
    pub cache_read_tokens: u64,
    #[serde(rename = "cacheCreationTokens")]
    pub cache_creation_tokens: u64,
    #[serde(rename = "nominalListCostMicroDollars")]
    pub nominal_list_cost_micro_dollars: u64,
    #[serde(rename = "effectiveCostMicroDollars")]
    pub effective_cost_micro_dollars: u64,
    #[serde(rename = "effectiveDiscountBps")]
    pub effective_discount_bps: u32,
    #[serde(rename = "contractModel")]
    pub contract_model: PricingModelType,
    #[serde(rename = "ptuCapacityApplied")]
    pub ptu_capacity_applied: u64,
    #[serde(rename = "ptuOverageTokens")]
    pub ptu_overage_tokens: u64,
    #[serde(rename = "toolCostMicroDollars", default)]
    pub tool_cost_micro_dollars: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CalculateToolCallRequest {
    #[serde(rename = "toolId")]
    pub tool_id: String,
    #[serde(default = "default_tool_count")]
    pub count: u64,
}

fn default_tool_count() -> u64 {
    1
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CalculateSpendRequest {
    #[serde(rename = "modelName")]
    pub model_name: String,
    #[serde(rename = "inputTokens", default)]
    pub input_tokens: u64,
    #[serde(rename = "outputTokens", default)]
    pub output_tokens: u64,
    #[serde(rename = "cacheReadTokens", default)]
    pub cache_read_tokens: u64,
    #[serde(rename = "cacheCreationTokens", default)]
    pub cache_creation_tokens: u64,
    #[serde(rename = "isBatch", default)]
    pub is_batch: bool,
    #[serde(rename = "toolCalls", default)]
    pub tool_calls: Vec<CalculateToolCallRequest>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TenantPricingModelResponse {
    pub pricing: TenantPricingModel,
    pub catalog: Vec<crate::finops::ModelCatalogEntry>,
    #[serde(rename = "toolCatalog")]
    pub tool_catalog: Vec<ToolCatalogEntry>,
}
