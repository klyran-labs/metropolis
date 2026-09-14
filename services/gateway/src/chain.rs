use crate::{
    config::Config,
    repository::{ChainEventRecord, PgRepository},
    telemetry::{EventHub, GatewayEvent},
    types::{IPolicyEngine, SpendRequest},
};
use alloy::{
    primitives::{Address, U256, keccak256},
    providers::{Provider, ProviderBuilder, ReqwestProvider},
};
use reqwest::Client;
use serde::Deserialize;
use serde_json::{Value, json};
use std::{sync::Arc, time::Duration};
use tokio::time::sleep;
use tracing::{debug, warn};

#[derive(Clone)]
pub struct ChainClient {
    pub provider: Arc<ReqwestProvider>,
    http: Client,
    config: Config,
}

impl ChainClient {
    pub fn new(config: Config, http: Client) -> Result<Self, String> {
        let url = config
            .rpc_url
            .parse()
            .map_err(|error| format!("Invalid MONAD_RPC_URL: {error}"))?;
        let provider = ProviderBuilder::new().on_http(url);
        Ok(Self {
            provider: Arc::new(provider),
            http,
            config,
        })
    }

    pub async fn evaluate_policy(
        &self,
        request: SpendRequest,
    ) -> Result<(bool, U256, u8, U256), String> {
        let contract = IPolicyEngine::new(self.config.policy_engine_address, self.provider.clone());
        contract
            .evaluate(request)
            .call()
            .await
            .map(|result| {
                (
                    result.allowed,
                    result.allowedAmount,
                    result.reasonCode,
                    result.evaluatedAtTimestamp,
                )
            })
            .map_err(|error| error.to_string())
    }

    pub async fn agent_policy(&self, agent: Address) -> Result<AgentPolicy, String> {
        let contract = IPolicyEngine::new(self.config.policy_engine_address, self.provider.clone());
        contract
            .getAgentPolicy(agent)
            .call()
            .await
            .map(|result| AgentPolicy {
                max_per_tx: U256::from(result.maxPerTx),
                max_per_window: U256::from(result.maxPerWindow),
                window_seconds: result.windowSeconds as u64,
                max_velocity: result.maxVelocity as u64,
                kill_switch: result.killSwitch,
                whitelist_enabled: result.whitelistEnabled,
            })
            .map_err(|error| error.to_string())
    }

    pub async fn health_check(&self) -> Result<u64, String> {
        let block = self
            .provider
            .get_block_number()
            .await
            .map_err(|error| error.to_string())?;
        self.verify_contracts().await?;
        Ok(block)
    }

    pub async fn verify_contracts(&self) -> Result<(), String> {
        let contracts = [
            ("PolicyEngine", self.config.policy_engine_address),
            (
                "ReputationRegistry",
                self.config.reputation_registry_address,
            ),
            ("AgentWalletGuard", self.config.agent_wallet_guard_address),
        ];
        for (name, address) in contracts {
            let code: String = self
                .rpc("eth_getCode", json!([format_address(address), "latest"]))
                .await?;
            if code == "0x" || code.trim().is_empty() {
                return Err(format!("{name} has no deployed bytecode at {address:#x}"));
            }
        }
        Ok(())
    }

    pub async fn transaction_receipt(
        &self,
        transaction_hash: &str,
    ) -> Result<Option<ChainReceipt>, String> {
        self.rpc("eth_getTransactionReceipt", json!([transaction_hash]))
            .await
    }

    pub async fn run_event_listener(self, repository: PgRepository, event_hub: EventHub) {
        let mut next_block = match repository.checkpoint(self.config.chain_id).await {
            Ok(Some((block, checkpoint_hash))) => {
                if block > 0 {
                    match self.block_hash(block - 1).await {
                        Ok(current_hash) if current_hash == checkpoint_hash => block,
                        Ok(_) => {
                            let rewind =
                                block.saturating_sub(self.config.event_finality_blocks.max(12));
                            if let Err(error) = repository
                                .mark_events_unfinalized_after(self.config.chain_id, rewind)
                                .await
                            {
                                warn!(error = %error, "Unable to mark potentially reorged events unfinalized");
                            }
                            rewind
                        }
                        Err(error) => {
                            warn!(error = %error, "Unable to validate event checkpoint; rewinding bounded range");
                            block.saturating_sub(self.config.event_finality_blocks.max(12))
                        }
                    }
                } else {
                    block
                }
            }
            Ok(None) => self.config.event_start_block,
            Err(error) => {
                warn!(error = %error, "Unable to load chain event checkpoint");
                self.config.event_start_block
            }
        };

        loop {
            match self.poll_events(&repository, &event_hub, next_block).await {
                Ok(Some(block)) => next_block = block,
                Ok(None) => {}
                Err(error) => warn!(error = %error, "Monad event ingestion cycle failed"),
            }
            sleep(Duration::from_millis(self.config.event_poll_interval_ms)).await;
        }
    }

    async fn poll_events(
        &self,
        repository: &PgRepository,
        event_hub: &EventHub,
        next_block: u64,
    ) -> Result<Option<u64>, String> {
        let latest = self.latest_block().await?;
        let safe_head = latest.saturating_sub(self.config.event_finality_blocks);
        if next_block > safe_head {
            return Ok(None);
        }

        let from_block = next_block;
        let to_block = (from_block + 999).min(safe_head);
        let logs = self.logs(from_block, to_block).await?;
        for log in logs {
            let Some(block_number) = parse_quantity(&log.block_number) else {
                continue;
            };
            let Some(log_index) = parse_quantity(&log.log_index) else {
                continue;
            };
            let Some(event_name) = event_name(&log.topics) else {
                continue;
            };
            let agent = log.topics.get(1).and_then(|topic| topic_address(topic));
            let org_id = match agent.as_deref() {
                Some(agent) => repository
                    .organization_for_agent(agent)
                    .await
                    .map_err(|error| error.to_string())?,
                None => None,
            };
            let payload = json!({
                "address": log.address,
                "topics": log.topics,
                "data": log.data,
            });
            let inserted = repository
                .insert_chain_event(ChainEventRecord {
                    chain_id: self.config.chain_id,
                    block_number,
                    block_hash: &log.block_hash,
                    transaction_hash: &log.transaction_hash,
                    log_index,
                    event_name,
                    agent_address: agent.as_deref(),
                    org_id: org_id.as_deref(),
                    payload: &payload,
                    finalized: true,
                })
                .await
                .map_err(|error| error.to_string())?;
            if inserted {
                event_hub.publish(GatewayEvent {
                    event_type: event_name.to_string(),
                    org_id,
                    agent,
                    chain_id: Some(self.config.chain_id),
                    block_number: Some(block_number),
                    transaction_hash: Some(log.transaction_hash.clone()),
                    finalized: true,
                    payload,
                });
            }
        }

        let checkpoint_hash = self.block_hash(to_block).await?;
        repository
            .save_checkpoint(self.config.chain_id, to_block + 1, &checkpoint_hash)
            .await
            .map_err(|error| error.to_string())?;
        debug!(from_block, to_block, "Indexed finalized Monad logs");
        Ok(Some(to_block + 1))
    }

    async fn latest_block(&self) -> Result<u64, String> {
        let value: String = self.rpc("eth_blockNumber", json!([])).await?;
        parse_quantity(&value).ok_or_else(|| "Monad returned an invalid block number".to_string())
    }

    async fn block_hash(&self, block: u64) -> Result<String, String> {
        let value: Option<RpcBlock> = self
            .rpc("eth_getBlockByNumber", json!([quantity(block), false]))
            .await?;
        value
            .map(|block| block.hash)
            .ok_or_else(|| "Monad returned no block for checkpoint".to_string())
    }

    async fn logs(&self, from_block: u64, to_block: u64) -> Result<Vec<RpcLog>, String> {
        self.rpc(
            "eth_getLogs",
            json!([{
                "fromBlock": quantity(from_block),
                "toBlock": quantity(to_block),
                "address": [format_address(self.config.policy_engine_address), format_address(self.config.agent_wallet_guard_address)]
            }]),
        ).await
    }

    async fn rpc<T: for<'de> Deserialize<'de>>(
        &self,
        method: &str,
        params: Value,
    ) -> Result<T, String> {
        let response = self
            .http
            .post(&self.config.rpc_url)
            .json(&json!({
                "jsonrpc": "2.0",
                "id": 1,
                "method": method,
                "params": params,
            }))
            .send()
            .await
            .map_err(|error| error.to_string())?;
        let status = response.status();
        let body = response
            .json::<RpcResponse<T>>()
            .await
            .map_err(|error| error.to_string())?;
        if !status.is_success() {
            return Err(format!("Monad RPC returned HTTP {status}"));
        }
        body.result.ok_or_else(|| {
            body.error
                .map(|error| error.message)
                .unwrap_or_else(|| "Monad RPC returned no result".to_string())
        })
    }
}

#[derive(Debug, Deserialize)]
struct RpcResponse<T> {
    result: Option<T>,
    error: Option<RpcError>,
}

#[derive(Debug, Deserialize)]
struct RpcError {
    message: String,
}

#[derive(Debug, Deserialize)]
struct RpcBlock {
    hash: String,
}

#[derive(Debug, Deserialize)]
struct RpcLog {
    address: String,
    topics: Vec<String>,
    data: String,
    #[serde(rename = "blockNumber")]
    block_number: String,
    #[serde(rename = "blockHash")]
    block_hash: String,
    #[serde(rename = "transactionHash")]
    transaction_hash: String,
    #[serde(rename = "logIndex")]
    log_index: String,
}

#[derive(Debug, Deserialize)]
pub struct ChainReceipt {
    #[serde(rename = "transactionHash")]
    pub transaction_hash: String,
    #[serde(rename = "blockNumber")]
    pub block_number: Option<String>,
    pub status: Option<String>,
    pub to: Option<String>,
    logs: Option<Vec<RpcLog>>,
}

impl ChainReceipt {
    pub fn matches_payment_execution(
        &self,
        guard: Address,
        agent: Address,
        merchant: Address,
        amount: U256,
        nonce: U256,
        token: Address,
    ) -> bool {
        if self.to.as_deref().map(str::to_ascii_lowercase) != Some(format!("{guard:#x}"))
            || self.status.as_deref() != Some("0x1")
        {
            return false;
        }
        let payment_topic =
            keccak256("PaymentExecuted(address,address,uint256,uint256,address)".as_bytes())
                .to_string();
        let expected_agent = format!("0x{:064x}", agent);
        let expected_merchant = format!("0x{:064x}", merchant);
        let expected_token = format!("0x{:064x}", token);
        self.logs.as_deref().is_some_and(|logs| {
            logs.iter().any(|log| {
                log.address.eq_ignore_ascii_case(&format!("{guard:#x}"))
                    && log.topics.len() == 3
                    && log.topics[0].eq_ignore_ascii_case(&payment_topic)
                    && log.topics[1].eq_ignore_ascii_case(&expected_agent)
                    && log.topics[2].eq_ignore_ascii_case(&expected_merchant)
                    && decode_payment_words(&log.data).is_some_and(
                        |(logged_amount, logged_nonce, logged_token)| {
                            logged_amount == amount
                                && logged_nonce == nonce
                                && logged_token == expected_token
                        },
                    )
            })
        })
    }
}

fn decode_payment_words(data: &str) -> Option<(U256, U256, String)> {
    let bytes = hex::decode(data.strip_prefix("0x").unwrap_or(data)).ok()?;
    if bytes.len() != 96 {
        return None;
    }
    let amount = U256::from_be_slice(&bytes[0..32]);
    let nonce = U256::from_be_slice(&bytes[32..64]);
    let token = format!("0x{}", hex::encode(&bytes[64..96]));
    Some((amount, nonce, token))
}

#[derive(Debug, Clone, Copy)]
pub struct AgentPolicy {
    pub max_per_tx: U256,
    pub max_per_window: U256,
    pub window_seconds: u64,
    pub max_velocity: u64,
    pub kill_switch: bool,
    pub whitelist_enabled: bool,
}

fn quantity(value: u64) -> String {
    format!("0x{value:x}")
}

fn parse_quantity(value: &str) -> Option<u64> {
    u64::from_str_radix(value.strip_prefix("0x").unwrap_or(value), 16).ok()
}

fn format_address(address: Address) -> String {
    format!("{address:#x}")
}

fn topic_address(topic: &str) -> Option<String> {
    let clean = topic.strip_prefix("0x").unwrap_or(topic);
    if clean.len() != 64 {
        return None;
    }
    Some(format!("0x{}", &clean[24..]))
}

fn event_name(topics: &[String]) -> Option<&'static str> {
    let topic = topics
        .first()?
        .strip_prefix("0x")
        .unwrap_or(topics.first()?);
    let signatures = [
        (
            "SpendEvaluated(address,address,uint256,bool,uint8)",
            "SpendEvaluated",
        ),
        (
            "SpendRecorded(address,uint256,uint128,uint32)",
            "SpendRecorded",
        ),
        ("KillSwitchUpdated(address,bool)", "KillSwitchUpdated"),
        (
            "PaymentExecuted(address,address,uint256,uint256,address)",
            "PaymentExecuted",
        ),
        (
            "PaymentBlocked(address,address,uint256,uint256,uint8)",
            "PaymentBlocked",
        ),
    ];
    signatures.iter().find_map(|(signature, name)| {
        (keccak256(signature.as_bytes())
            .to_string()
            .strip_prefix("0x")
            .unwrap_or_default()
            == topic)
            .then_some(*name)
    })
}
