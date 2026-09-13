use alloy::primitives::{Address, B256};
use std::env;
use std::str::FromStr;

#[derive(Clone, Debug)]
#[allow(dead_code)]
pub struct Config {
    pub port: u16,
    pub chain_id: u64,
    pub rpc_url: String,
    pub policy_engine_address: Address,
    pub reputation_registry_address: Address,
    pub agent_wallet_guard_address: Address,
    pub usdc_token_address: Address,
    pub merchant_address: Address,
    pub relayer_private_key: Option<B256>,
    pub privy_app_id: String,
    pub privy_app_secret: Option<String>,
    pub initial_super_admin_dids: Vec<String>,
}

fn parse_address(env_var: &str, default: Option<&str>) -> Result<Address, String> {
    let raw = env::var(env_var).ok().or_else(|| default.map(String::from));
    match raw {
        Some(val) => Address::from_str(&val)
            .map_err(|e| format!("Invalid Ethereum address in {}: {} ({})", env_var, val, e)),
        None => Err(format!("Missing required environment variable: {}", env_var)),
    }
}

impl Config {
    pub fn from_env() -> Result<Self, String> {
        let port = env::var("PORT")
            .ok()
            .and_then(|p| p.parse::<u16>().ok())
            .unwrap_or(8080);

        let chain_id = env::var("MONAD_CHAIN_ID")
            .ok()
            .and_then(|c| c.parse::<u64>().ok())
            .unwrap_or(10143);

        let rpc_url = env::var("MONAD_RPC_URL")
            .unwrap_or_else(|_| "https://testnet-rpc.monad.xyz".to_string());

        let policy_engine_address = parse_address(
            "POLICY_ENGINE_ADDRESS",
            Some("0x5fbdb2315678afecb367f032d93f642f64180aa3"),
        )?;
        let reputation_registry_address = parse_address(
            "REPUTATION_REGISTRY_ADDRESS",
            Some("0xe7f1725e7734ce288f8367e1bb143e90bb3f0512"),
        )?;
        let agent_wallet_guard_address = parse_address(
            "AGENT_WALLET_GUARD_ADDRESS",
            Some("0x9fe46736679d2d9a65f0992f2272de9f3c7fa6e0"),
        )?;
        let usdc_token_address = parse_address(
            "USDC_TOKEN_ADDRESS",
            Some("0xf817257fed379853cDe0fa4F97AB987181B1E5Ea"),
        )?;
        let merchant_address = parse_address(
            "GATEWAY_MERCHANT_ADDRESS",
            Some("0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC"),
        )?;

        let relayer_private_key = env::var("GATEWAY_RELAYER_PRIVATE_KEY")
            .ok()
            .and_then(|k| {
                let trimmed = k.trim();
                let clean = trimmed.strip_prefix("0x").unwrap_or(trimmed);
                B256::from_str(clean).ok()
            });

        let privy_app_id = env::var("PRIVY_APP_ID")
            .unwrap_or_else(|_| "cmton65ao004l0cl11tgmwiah".to_string());

        let privy_app_secret = env::var("PRIVY_APP_SECRET")
            .ok()
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty());

        let initial_super_admin_dids = env::var("INITIAL_SUPER_ADMIN_DIDS")
            .unwrap_or_default()
            .split(',')
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty())
            .collect();

        Ok(Config {
            port,
            chain_id,
            rpc_url,
            policy_engine_address,
            reputation_registry_address,
            agent_wallet_guard_address,
            usdc_token_address,
            merchant_address,
            relayer_private_key,
            privy_app_id,
            privy_app_secret,
            initial_super_admin_dids,
        })
    }
}
