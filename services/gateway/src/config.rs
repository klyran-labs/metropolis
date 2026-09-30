use alloy::primitives::{Address, U256};
use serde::Deserialize;
use std::{env, fs, path::PathBuf, str::FromStr};

const OFFICIAL_PRIVY_APP_ID: &str = "cmton65ao004l0cl11tgmwiah";

#[derive(Clone, Debug, Deserialize)]
pub struct DeploymentManifest {
    pub environment: String,
    #[serde(default)]
    pub status: Option<String>,
    #[serde(rename = "chainId")]
    pub chain_id: u64,
    #[serde(rename = "rpcEndpoints", default)]
    pub rpc_endpoints: Vec<String>,
    pub contracts: DeploymentContracts,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum NetworkProfile {
    Local,
    Testnet,
    Mainnet,
}

impl NetworkProfile {
    pub fn parse(value: &str) -> Result<Self, String> {
        match value {
            "local" => Ok(Self::Local),
            "testnet" => Ok(Self::Testnet),
            "mainnet" => Ok(Self::Mainnet),
            _ => Err(format!(
                "Invalid AGENTGUARD_PROFILE {value}; expected local, testnet, or mainnet"
            )),
        }
    }

    pub const fn chain_id(self) -> u64 {
        match self {
            Self::Local | Self::Testnet => 10143,
            Self::Mainnet => 143,
        }
    }

    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Local => "local",
            Self::Testnet => "testnet",
            Self::Mainnet => "mainnet",
        }
    }

    pub const fn network_name(self) -> &'static str {
        match self {
            Self::Local => "monad-local",
            Self::Testnet => "monad-testnet",
            Self::Mainnet => "monad-mainnet",
        }
    }
}

#[derive(Clone, Debug, Default, Deserialize)]
pub struct DeploymentContracts {
    #[serde(rename = "policyEngine")]
    pub policy_engine: Option<DeploymentContract>,
    #[serde(rename = "reputationRegistry")]
    pub reputation_registry: Option<DeploymentContract>,
    #[serde(rename = "agentWalletGuard")]
    pub agent_wallet_guard: Option<DeploymentContract>,
    #[serde(rename = "circuitPaymaster")]
    pub circuit_paymaster: Option<DeploymentContract>,
    #[serde(rename = "circuitVault")]
    pub circuit_vault: Option<DeploymentContract>,
    #[serde(rename = "settlementToken")]
    pub settlement_token: Option<DeploymentContract>,
}

#[derive(Clone, Debug, Deserialize)]
pub struct DeploymentContract {
    pub address: String,
}

#[derive(Clone, Debug)]
pub struct Config {
    pub port: u16,
    pub profile: NetworkProfile,
    pub chain_id: u64,
    pub deployment_manifest_path: PathBuf,
    pub rpc_url: String,
    pub policy_engine_address: Address,
    pub reputation_registry_address: Address,
    pub agent_wallet_guard_address: Address,
    pub circuit_paymaster_address: Address,
    pub circuit_vault_address: Address,
    pub paymaster_verification_gas_limit: U256,
    pub paymaster_post_op_gas_limit: U256,
    pub usdc_token_address: Address,
    pub merchant_address: Address,
    pub opensigner_url: String,
    pub opensigner_api_token: String,
    pub database_url: String,
    pub privy_app_id: String,
    pub privy_issuer: String,
    pub privy_jwks_url: String,
    pub jwks_cache_seconds: u64,
    pub trust_proxy_headers: bool,
    pub event_finality_blocks: u64,
    pub event_poll_interval_ms: u64,
    pub event_start_block: u64,
    pub environment: String,
    pub inference_price_base_units: String,
    pub inference_service_id: String,
    pub inference_category: String,
    pub cors_allowed_origins: Vec<String>,
    pub dashscope_api_key: Option<String>,
    pub dashscope_base_url: String,
    pub anthropic_api_key: Option<String>,
    pub anthropic_base_url: String,
    pub tenant_max_concurrency: usize,
    pub max_tracked_tenants: usize,
    pub provider_max_concurrency: usize,
    pub rpc_max_concurrency: usize,
    pub rpc_fallback_urls: Vec<String>,
    pub policy_cache_ttl_ms: u64,
    pub nonce_lease_ttl_ms: u64,
}

fn required(name: &str) -> Result<String, String> {
    env::var(name)
        .map(|value| value.trim().to_string())
        .ok()
        .filter(|value| !value.is_empty())
        .ok_or_else(|| format!("Missing required environment variable: {name}"))
}

fn parse_required<T>(name: &str) -> Result<T, String>
where
    T: FromStr,
    T::Err: std::fmt::Display,
{
    required(name)?
        .parse::<T>()
        .map_err(|error| format!("Invalid {name}: {error}"))
}

fn parse_address(name: &str) -> Result<Address, String> {
    let value = required(name)?;
    let address = Address::from_str(&value).map_err(|error| format!("Invalid {name}: {error}"))?;
    if address == Address::ZERO {
        return Err(format!("{name} must not be the zero address"));
    }
    Ok(address)
}

fn parse_u256(name: &str) -> Result<U256, String> {
    let value = required(name)?;
    let (digits, radix) = value
        .strip_prefix("0x")
        .map_or((value.as_str(), 10), |hex| (hex, 16));
    let parsed =
        U256::from_str_radix(digits, radix).map_err(|error| format!("Invalid {name}: {error}"))?;
    if parsed.is_zero() {
        return Err(format!("{name} must be greater than zero"));
    }
    Ok(parsed)
}

fn parse_positive_limit(name: &str, default: usize) -> Result<usize, String> {
    let value = env::var(name)
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .map(|value| {
            value
                .parse::<usize>()
                .map_err(|error| format!("Invalid {name}: {error}"))
        })
        .transpose()?
        .unwrap_or(default);
    if value == 0 {
        return Err(format!("{name} must be greater than zero"));
    }
    Ok(value)
}

fn parse_manifest_address(
    name: &str,
    address: Option<&DeploymentContract>,
) -> Result<Address, String> {
    let address = address
        .ok_or_else(|| format!("Deployment manifest is missing {name}"))?
        .address
        .parse::<Address>()
        .map_err(|error| format!("Invalid {name} in deployment manifest: {error}"))?;
    if address == Address::ZERO {
        return Err(format!(
            "Deployment manifest {name} must not be the zero address"
        ));
    }
    Ok(address)
}

fn parse_address_with_manifest_fallback(
    name: &str,
    manifest_name: &str,
    manifest_contract: Option<&DeploymentContract>,
) -> Result<Address, String> {
    let manifest_addr = parse_manifest_address(manifest_name, manifest_contract)?;
    match env::var(name).ok().map(|v| v.trim().to_string()).filter(|v| !v.is_empty()) {
        Some(value) => {
            let address = Address::from_str(&value).map_err(|error| format!("Invalid {name}: {error}"))?;
            if address == Address::ZERO {
                return Err(format!("{name} must not be the zero address"));
            }
            require_manifest_match(name, address, manifest_addr)?;
            Ok(address)
        }
        None => Ok(manifest_addr),
    }
}

fn load_manifest(
    path: &PathBuf,
    profile: NetworkProfile,
    chain_id: u64,
) -> Result<DeploymentManifest, String> {
    let content = fs::read_to_string(path).map_err(|error| {
        format!(
            "Unable to read deployment manifest {}: {error}",
            path.display()
        )
    })?;
    let manifest = serde_json::from_str::<DeploymentManifest>(&content)
        .map_err(|error| format!("Invalid deployment manifest {}: {error}", path.display()))?;
    if manifest.environment != profile.as_str() {
        return Err(format!(
            "Deployment manifest environment {} does not match AGENTGUARD_PROFILE {}",
            manifest.environment,
            profile.as_str()
        ));
    }
    if manifest.status.as_deref() == Some("unprovisioned") {
        return Err("Deployment manifest is explicitly unprovisioned".to_string());
    }
    if manifest.chain_id != chain_id {
        return Err(format!(
            "Deployment manifest chain ID {} does not match MONAD_CHAIN_ID {chain_id}",
            manifest.chain_id
        ));
    }
    parse_manifest_address("policyEngine", manifest.contracts.policy_engine.as_ref())?;
    parse_manifest_address(
        "reputationRegistry",
        manifest.contracts.reputation_registry.as_ref(),
    )?;
    parse_manifest_address(
        "agentWalletGuard",
        manifest.contracts.agent_wallet_guard.as_ref(),
    )?;
    parse_manifest_address(
        "circuitPaymaster",
        manifest.contracts.circuit_paymaster.as_ref(),
    )?;
    parse_manifest_address("circuitVault", manifest.contracts.circuit_vault.as_ref())?;
    Ok(manifest)
}

fn require_manifest_match(
    name: &str,
    configured: Address,
    manifest: Address,
) -> Result<(), String> {
    if configured != manifest {
        return Err(format!(
            "{name} does not match the authoritative deployment manifest"
        ));
    }
    Ok(())
}

fn parse_bool(name: &str, default: bool) -> Result<bool, String> {
    match env::var(name) {
        Ok(value) => value
            .parse::<bool>()
            .map_err(|error| format!("Invalid {name}: {error}")),
        Err(_) => Ok(default),
    }
}

impl Config {
    pub fn from_env() -> Result<Self, String> {
        let profile = NetworkProfile::parse(&required("AGENTGUARD_PROFILE")?)?;
        let chain_id = parse_required::<u64>("MONAD_CHAIN_ID")?;
        if chain_id != profile.chain_id() {
            return Err(format!(
                "MONAD_CHAIN_ID {} does not match AGENTGUARD_PROFILE {} (expected {})",
                chain_id,
                profile.as_str(),
                profile.chain_id()
            ));
        }
        let environment = required("NODE_ENV")?;
        let deployment_manifest_path = PathBuf::from(required("DEPLOYMENT_MANIFEST_PATH")?);
        let manifest = load_manifest(&deployment_manifest_path, profile, chain_id)?;
        let policy_engine_address = parse_address_with_manifest_fallback(
            "POLICY_ENGINE_ADDRESS",
            "policyEngine",
            manifest.contracts.policy_engine.as_ref(),
        )?;
        let reputation_registry_address = parse_address_with_manifest_fallback(
            "REPUTATION_REGISTRY_ADDRESS",
            "reputationRegistry",
            manifest.contracts.reputation_registry.as_ref(),
        )?;
        let agent_wallet_guard_address = parse_address_with_manifest_fallback(
            "AGENT_WALLET_GUARD_ADDRESS",
            "agentWalletGuard",
            manifest.contracts.agent_wallet_guard.as_ref(),
        )?;
        let circuit_paymaster_address = parse_manifest_address(
            "circuitPaymaster",
            manifest.contracts.circuit_paymaster.as_ref(),
        )?;
        let circuit_vault_address =
            parse_manifest_address("circuitVault", manifest.contracts.circuit_vault.as_ref())?;
        let paymaster_verification_gas_limit = parse_u256("PAYMASTER_VERIFICATION_GAS_LIMIT")?;
        let paymaster_post_op_gas_limit = parse_u256("PAYMASTER_POST_OP_GAS_LIMIT")?;

        let event_finality_blocks = env::var("MONAD_FINALITY_BLOCKS")
            .ok()
            .map(|value| {
                value
                    .parse::<u64>()
                    .map_err(|error| format!("Invalid MONAD_FINALITY_BLOCKS: {error}"))
            })
            .transpose()?
            .unwrap_or(2);
        let event_poll_interval_ms = env::var("EVENT_POLL_INTERVAL_MS")
            .ok()
            .map(|value| {
                value
                    .parse::<u64>()
                    .map_err(|error| format!("Invalid EVENT_POLL_INTERVAL_MS: {error}"))
            })
            .transpose()?
            .unwrap_or(400);
        let event_start_block = parse_required::<u64>("EVENT_START_BLOCK")?;
        if event_finality_blocks == 0 || event_poll_interval_ms == 0 {
            return Err("Finality and event polling intervals must be positive".to_string());
        }

        let privy_app_id = required("PRIVY_APP_ID")?;
        if privy_app_id != OFFICIAL_PRIVY_APP_ID {
            return Err("PRIVY_APP_ID does not match the configured AgentGuard application".into());
        }

        let cors_allowed_origins = required("CORS_ALLOWED_ORIGINS")?
            .split(',')
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_string)
            .collect::<Vec<_>>();
        if cors_allowed_origins.is_empty() {
            return Err("CORS_ALLOWED_ORIGINS must contain at least one origin".into());
        }

        Ok(Self {
            port: env::var("PORT")
                .ok()
                .map(|value| value.parse::<u16>())
                .transpose()
                .map_err(|error| format!("Invalid PORT: {error}"))?
                .unwrap_or(8080),
            profile,
            chain_id,
            deployment_manifest_path,
            rpc_url: {
                let raw_rpc = required("MONAD_RPC_URL")?;
                let rpc_urls: Vec<String> = raw_rpc
                    .split(',')
                    .map(|s| s.trim().to_string())
                    .filter(|s| !s.is_empty())
                    .collect();
                rpc_urls.first().cloned().unwrap_or(raw_rpc)
            },
            rpc_fallback_urls: {
                let raw_rpc = env::var("MONAD_RPC_URL").unwrap_or_default();
                let rpc_urls: Vec<String> = raw_rpc
                    .split(',')
                    .map(|s| s.trim().to_string())
                    .filter(|s| !s.is_empty())
                    .collect();
                let mut fallbacks = if rpc_urls.len() > 1 {
                    rpc_urls[1..].to_vec()
                } else {
                    Vec::new()
                };
                if let Ok(env_fallbacks) = env::var("MONAD_RPC_FALLBACK_URLS") {
                    for url in env_fallbacks.split(',').map(|s| s.trim().to_string()).filter(|s| !s.is_empty()) {
                        if !fallbacks.contains(&url) {
                            fallbacks.push(url);
                        }
                    }
                }
                fallbacks
            },
            policy_cache_ttl_ms: env::var("POLICY_CACHE_TTL_MS")
                .ok()
                .and_then(|v| v.parse::<u64>().ok())
                .unwrap_or(3_000),
            nonce_lease_ttl_ms: env::var("NONCE_LEASE_TTL_MS")
                .ok()
                .and_then(|v| v.parse::<u64>().ok())
                .unwrap_or(5_000),
            policy_engine_address,
            reputation_registry_address,
            agent_wallet_guard_address,
            circuit_paymaster_address,
            circuit_vault_address,
            paymaster_verification_gas_limit,
            paymaster_post_op_gas_limit,
            usdc_token_address: if manifest.contracts.settlement_token.is_some() {
                parse_address_with_manifest_fallback(
                    "USDC_TOKEN_ADDRESS",
                    "settlementToken",
                    manifest.contracts.settlement_token.as_ref(),
                )?
            } else {
                parse_address("USDC_TOKEN_ADDRESS")?
            },
            merchant_address: parse_address("GATEWAY_MERCHANT_ADDRESS")?,
            opensigner_url: required("OPENSIGNER_URL")?,
            opensigner_api_token: required("OPENSIGNER_API_TOKEN")?,
            database_url: required("DATABASE_URL")?,
            privy_app_id,
            privy_issuer: required("PRIVY_ISSUER")?,
            privy_jwks_url: required("PRIVY_JWKS_URL")?,
            jwks_cache_seconds: env::var("PRIVY_JWKS_CACHE_SECONDS")
                .ok()
                .map(|value| value.parse::<u64>())
                .transpose()
                .map_err(|error| format!("Invalid PRIVY_JWKS_CACHE_SECONDS: {error}"))?
                .unwrap_or(300),
            trust_proxy_headers: parse_bool("TRUST_PROXY_HEADERS", false)?,
            event_finality_blocks,
            event_poll_interval_ms,
            event_start_block,
            environment,
            inference_price_base_units: required("INFERENCE_PRICE_BASE_UNITS")?,
            inference_service_id: required("INFERENCE_SERVICE_ID")?,
            inference_category: required("INFERENCE_CATEGORY")?,
            cors_allowed_origins,
            dashscope_api_key: env::var("DASHSCOPE_API_KEY")
                .ok()
                .map(|v| v.trim().to_string())
                .filter(|v| !v.is_empty()),
            dashscope_base_url: env::var("DASHSCOPE_BASE_URL").unwrap_or_else(|_| {
                "https://dashscope-intl.aliyuncs.com/compatible-mode/v1".to_string()
            }),
            anthropic_api_key: env::var("ANTHROPIC_API_KEY")
                .ok()
                .map(|v| v.trim().to_string())
                .filter(|v| !v.is_empty()),
            anthropic_base_url: env::var("ANTHROPIC_BASE_URL")
                .unwrap_or_else(|_| "https://api.anthropic.com/v1".to_string()),
            tenant_max_concurrency: parse_positive_limit("TENANT_MAX_CONCURRENCY", 64)?,
            max_tracked_tenants: parse_positive_limit("MAX_TRACKED_TENANTS", 10_000)?,
            provider_max_concurrency: parse_positive_limit("PROVIDER_MAX_CONCURRENCY", 32)?,
            rpc_max_concurrency: parse_positive_limit("RPC_MAX_CONCURRENCY", 128)?,
        })
    }

    #[doc(hidden)]
    pub fn test() -> Self {
        Self {
            port: 8080,
            profile: NetworkProfile::Local,
            chain_id: 10143,
            deployment_manifest_path: PathBuf::from("test/deployment-manifest.json"),
            rpc_url: "http://127.0.0.1:8545".to_string(),
            rpc_fallback_urls: Vec::new(),
            policy_cache_ttl_ms: 3_000,
            nonce_lease_ttl_ms: 5_000,
            policy_engine_address: Address::repeat_byte(0x11),
            reputation_registry_address: Address::repeat_byte(0x12),
            agent_wallet_guard_address: Address::repeat_byte(0x13),
            circuit_paymaster_address: Address::repeat_byte(0x16),
            circuit_vault_address: Address::repeat_byte(0x17),
            paymaster_verification_gas_limit: U256::from(100_000),
            paymaster_post_op_gas_limit: U256::from(40_000),
            usdc_token_address: Address::repeat_byte(0x14),
            merchant_address: Address::repeat_byte(0x15),
            opensigner_url: "http://127.0.0.1:3001".to_string(),
            opensigner_api_token: "test-opensigner-token".to_string(),
            database_url: "postgres://test:test@127.0.0.1/agentguard".to_string(),
            privy_app_id: "test-app".to_string(),
            privy_issuer: "privy.io".to_string(),
            privy_jwks_url: "http://127.0.0.1/jwks".to_string(),
            jwks_cache_seconds: 300,
            trust_proxy_headers: false,
            event_finality_blocks: 2,
            event_poll_interval_ms: 400,
            event_start_block: 0,
            environment: "test".to_string(),
            inference_price_base_units: "0".to_string(),
            inference_service_id: "test.service".to_string(),
            inference_category: "test".to_string(),
            cors_allowed_origins: vec!["http://test.local".to_string()],
            dashscope_api_key: None,
            dashscope_base_url: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1"
                .to_string(),
            anthropic_api_key: None,
            anthropic_base_url: "https://api.anthropic.com/v1".to_string(),
            tenant_max_concurrency: 64,
            max_tracked_tenants: 10_000,
            provider_max_concurrency: 32,
            rpc_max_concurrency: 128,
        }
    }
}
