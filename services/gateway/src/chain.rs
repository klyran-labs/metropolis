use crate::{
    config::Config,
    repository::{ChainEventRecord, PgRepository},
    telemetry::{EventHub, GatewayEvent},
    types::{IERC20Balance, IERC1271, IPolicyEngine, SpendRequest},
};
use alloy::{
    primitives::{Address, B256, U256, keccak256},
    providers::{Provider, ProviderBuilder, ReqwestProvider},
};
use reqwest::Client;
use serde::Deserialize;
use serde_json::{Value, json};
use std::{collections::HashSet, sync::Arc, time::Duration};
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

    pub async fn is_merchant_whitelisted(
        &self,
        agent: Address,
        merchant: Address,
    ) -> Result<bool, String> {
        let contract = IPolicyEngine::new(self.config.policy_engine_address, self.provider.clone());
        contract
            .isMerchantWhitelisted(agent, merchant)
            .call()
            .await
            .map(|result| result._0)
            .map_err(|error| error.to_string())
    }

    /// ERC-1271 `isValidSignature` check against a smart-contract wallet (e.g. a Safe). Returns
    /// false (not an error) when `contract` has no bytecode or reverts, since that just means
    /// "not a valid contract signer" rather than a chain-connectivity failure.
    pub async fn verify_erc1271_signature(
        &self,
        contract: Address,
        digest: B256,
        signature: &[u8],
    ) -> bool {
        const ERC1271_MAGIC_VALUE: [u8; 4] = [0x16, 0x26, 0xba, 0x7e];
        let binding = IERC1271::new(contract, self.provider.clone());
        binding
            .isValidSignature(digest, signature.to_vec().into())
            .call()
            .await
            .map(|result| result.magicValue.0 == ERC1271_MAGIC_VALUE)
            .unwrap_or(false)
    }

    pub async fn token_balance(&self, token: Address, holder: Address) -> Result<U256, String> {
        let contract = IERC20Balance::new(token, self.provider.clone());
        contract
            .balanceOf(holder)
            .call()
            .await
            .map(|result| result._0)
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
        let from_block = next_block;
        // Single HTTP round-trip: eth_blockNumber + eth_getLogs fused into one JSON-RPC batch.
        // Saves one complete RPC round-trip (5-30ms) per 400ms Monad poll cycle.
        let (latest, all_logs) = self.rpc_batch_block_and_logs(from_block).await?;
        let safe_head = latest.saturating_sub(self.config.event_finality_blocks);
        if from_block > safe_head {
            return Ok(None);
        }

        let to_block = (from_block + 999).min(safe_head);
        // Clip logs to the safe finality window — discard anything beyond safe_head
        let logs: Vec<_> = all_logs
            .into_iter()
            .filter(|log| {
                parse_quantity(&log.block_number).map_or(false, |bn| bn <= to_block)
            })
            .collect();

        // Batch-resolve org_ids: collect all unique agent addresses from the log batch
        // first, then issue a single `WHERE agent_address = ANY($1)` query.
        // This reduces N sequential DB round-trips (one per log) to exactly 1
        // regardless of batch size — critical for low-latency 400ms Monad block ingestion.
        let agent_addresses: Vec<String> = logs
            .iter()
            .filter_map(|log| log.topics.get(1).and_then(|topic| topic_address(topic)))
            .map(|addr| addr.to_string())
            .collect::<HashSet<_>>()
            .into_iter()
            .collect();

        let org_map = repository
            .organizations_for_agents(&agent_addresses)
            .await
            .map_err(|error| error.to_string())?;

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
            // O(1) HashMap lookup — org_id was pre-fetched for the entire batch above
            let org_id = agent.as_deref().and_then(|addr| org_map.get(addr)).cloned();
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

    pub fn check_dispute_finalization_readiness(
        current_block: u64,
        challenge_block: u64,
    ) -> bool {
        current_block >= challenge_block.saturating_add(200)
    }

    async fn block_hash(&self, block: u64) -> Result<String, String> {
        let value: Option<RpcBlock> = self
            .rpc("eth_getBlockByNumber", json!([quantity(block), false]))
            .await?;
        value
            .map(|block| block.hash)
            .ok_or_else(|| "Monad returned no block for checkpoint".to_string())
    }

    /// JSON-RPC batch: fetches `eth_blockNumber` and `eth_getLogs` in a **single HTTP round-trip**.
    ///
    /// Standard JSON-RPC 2.0 batch (EIP-1474): sends an array of request objects and receives an
    /// array of response objects. Eliminates the sequential `latest_block().await?` +
    /// `logs().await?` pattern that cost 2 round-trips per poll cycle (5-30ms each on Monad RPC).
    async fn rpc_batch_block_and_logs(
        &self,
        from_block: u64,
        // We use "latest" as toBlock for the initial scan; caller clips to safe_head afterward.
        // This avoids a chicken-and-egg dependency where we need block number to call eth_getLogs.
    ) -> Result<(u64, Vec<RpcLog>), String> {
        let batch = json!([
            { "jsonrpc": "2.0", "id": 1, "method": "eth_blockNumber", "params": [] },
            {
                "jsonrpc": "2.0", "id": 2, "method": "eth_getLogs",
                "params": [{
                    "fromBlock": quantity(from_block),
                    "toBlock": "latest",
                    "address": [
                        format_address(self.config.policy_engine_address),
                        format_address(self.config.agent_wallet_guard_address)
                    ]
                }]
            }
        ]);

        let response = self
            .http
            .post(&self.config.rpc_url)
            .json(&batch)
            .send()
            .await
            .map_err(|e| e.to_string())?;

        // Batch responses are a JSON array — order is not guaranteed by spec; match by `id`.
        let raw: Vec<serde_json::Value> = response
            .json()
            .await
            .map_err(|e| format!("Monad batch RPC parse error: {e}"))?;

        let mut block_number_hex: Option<String> = None;
        let mut logs: Option<Vec<RpcLog>> = None;

        for item in raw {
            match item.get("id").and_then(|v| v.as_u64()) {
                Some(1) => {
                    block_number_hex = item
                        .get("result")
                        .and_then(|v| v.as_str())
                        .map(|s| s.to_string());
                }
                Some(2) => {
                    if let Some(result) = item.get("result") {
                        logs = serde_json::from_value(result.clone()).ok();
                    }
                }
                _ => {}
            }
        }

        let latest = block_number_hex
            .as_deref()
            .and_then(parse_quantity)
            .ok_or_else(|| "Monad batch RPC: missing eth_blockNumber result".to_string())?;
        let logs = logs.ok_or_else(|| "Monad batch RPC: missing eth_getLogs result".to_string())?;

        Ok((latest, logs))
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

    pub fn matches_erc20_transfer(
        &self,
        token: Address,
        from: Address,
        to: Address,
        amount: U256,
    ) -> bool {
        if self.to.as_deref().map(str::to_ascii_lowercase) != Some(format!("{token:#x}"))
            || self.status.as_deref() != Some("0x1")
        {
            return false;
        }
        let transfer_topic = keccak256("Transfer(address,address,uint256)".as_bytes()).to_string();
        let expected_from = format!("0x{:064x}", from);
        let expected_to = format!("0x{:064x}", to);
        self.logs.as_deref().is_some_and(|logs| {
            logs.iter().any(|log| {
                log.address.eq_ignore_ascii_case(&format!("{token:#x}"))
                    && log.topics.len() == 3
                    && log.topics[0].eq_ignore_ascii_case(&transfer_topic)
                    && log.topics[1].eq_ignore_ascii_case(&expected_from)
                    && log.topics[2].eq_ignore_ascii_case(&expected_to)
                    && decode_transfer_amount(&log.data) == Some(amount)
            })
        })
    }
}

fn decode_transfer_amount(data: &str) -> Option<U256> {
    let bytes = hex::decode(data.strip_prefix("0x").unwrap_or(data)).ok()?;
    if bytes.len() != 32 {
        return None;
    }
    Some(U256::from_be_slice(&bytes))
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
        (
            "CircuitBreakerTripped(address,address)",
            "CircuitBreakerTripped",
        ),
        (
            "CircuitBreakerReset(address,address)",
            "CircuitBreakerReset",
        ),
        (
            "EpochRolledOver(address,address,uint256,uint256,uint128,uint128)",
            "EpochRolledOver",
        ),
        (
            "EpochBucketAllocated(address,address,uint256,uint128,uint32)",
            "EpochBucketAllocated",
        ),
        (
            "VoucherDeltaSettled(address,address,uint256,uint128,uint128)",
            "VoucherDeltaSettled",
        ),
        (
            "TerminalClosed(address,address,uint256,uint128,uint128)",
            "TerminalClosed",
        ),
        (
            "UnilateralChallengeInitiated(address,bytes32,uint256,uint128)",
            "UnilateralChallengeInitiated",
        ),
        (
            "UnilateralCloseFinalized(address,address,bytes32,uint128,uint128)",
            "UnilateralCloseFinalized",
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
