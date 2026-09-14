use alloy::primitives::Address;
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
        let policy_engine_address = parse_address("POLICY_ENGINE_ADDRESS")?;
        let reputation_registry_address = parse_address("REPUTATION_REGISTRY_ADDRESS")?;
        let agent_wallet_guard_address = parse_address("AGENT_WALLET_GUARD_ADDRESS")?;
        require_manifest_match(
            "POLICY_ENGINE_ADDRESS",
            policy_engine_address,
            parse_manifest_address("policyEngine", manifest.contracts.policy_engine.as_ref())?,
        )?;
        require_manifest_match(
            "REPUTATION_REGISTRY_ADDRESS",
            reputation_registry_address,
            parse_manifest_address(
                "reputationRegistry",
                manifest.contracts.reputation_registry.as_ref(),
            )?,
        )?;
        require_manifest_match(
            "AGENT_WALLET_GUARD_ADDRESS",
            agent_wallet_guard_address,
            parse_manifest_address(
                "agentWalletGuard",
                manifest.contracts.agent_wallet_guard.as_ref(),
            )?,
        )?;

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
            rpc_url: required("MONAD_RPC_URL")?,
            policy_engine_address,
            reputation_registry_address,
            agent_wallet_guard_address,
            usdc_token_address: parse_address("USDC_TOKEN_ADDRESS")?,
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
            policy_engine_address: Address::repeat_byte(0x11),
            reputation_registry_address: Address::repeat_byte(0x12),
            agent_wallet_guard_address: Address::repeat_byte(0x13),
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
        }
    }
}
