use crate::{
    config::Config,
    nonce_sequencer::NonceSequencer,
    policy_cache::PolicyEngineCache,
    repository::{ChainEventRecord, PgRepository},
    telemetry::{EventHub, GatewayEvent},
    types::{ICircuitPaymaster, IERC20Balance, IERC1271, IPolicyEngine, SpendRequest},
};
use alloy::{
    primitives::{Address, B256, U256, keccak256},
    providers::{Provider, ProviderBuilder, ReqwestProvider},
};
use reqwest::Client;
use serde::Deserialize;
use serde_json::{Value, json};
use std::{collections::HashSet, sync::Arc, time::Duration};
use tokio::{sync::Semaphore, time::sleep};
use tracing::{debug, info, warn};

#[derive(Clone)]
pub struct ChainClient {
    pub provider: Arc<ReqwestProvider>,
    pub fallback_providers: Vec<Arc<ReqwestProvider>>,
    pub policy_cache: Arc<PolicyEngineCache>,
    pub nonce_sequencer: Arc<NonceSequencer>,
    http: Client,
    config: Config,
    rpc_bulkhead: Arc<Semaphore>,
}

impl ChainClient {
    pub fn new(config: Config, http: Client, rpc_max_concurrency: usize) -> Result<Self, String> {
        if rpc_max_concurrency == 0 {
            return Err("RPC_MAX_CONCURRENCY must be greater than zero".to_string());
        }
        let url = config
            .rpc_url
            .parse()
            .map_err(|error| format!("Invalid MONAD_RPC_URL: {error}"))?;
        let provider = ProviderBuilder::new().on_http(url);

        let mut fallback_providers = Vec::new();
        for fallback_url in &config.rpc_fallback_urls {
            if let Ok(parsed) = fallback_url.parse() {
                fallback_providers.push(Arc::new(ProviderBuilder::new().on_http(parsed)));
            }
        }

        let policy_cache = Arc::new(PolicyEngineCache::new(config.policy_cache_ttl_ms));
        let nonce_sequencer = Arc::new(NonceSequencer::new(config.nonce_lease_ttl_ms));

        Ok(Self {
            provider: Arc::new(provider),
            fallback_providers,
            policy_cache,
            nonce_sequencer,
            http,
            config,
            rpc_bulkhead: Arc::new(Semaphore::new(rpc_max_concurrency)),
        })
    }

    fn try_rpc_permit(&self) -> Result<tokio::sync::OwnedSemaphorePermit, String> {
        self.rpc_bulkhead
            .clone()
            .try_acquire_owned()
            .map_err(|_| "Monad RPC concurrency capacity is exhausted".to_string())
    }

    pub async fn evaluate_policy(
        &self,
        request: SpendRequest,
    ) -> Result<(bool, U256, u8, U256), String> {
        // 1. Fast-path: Check in-memory policy cache (<1 microsecond)
        if let Some((false, reason_code)) = self.policy_cache.evaluate_fast_path(&request) {
            let now = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_secs())
                .unwrap_or(0);
            return Ok((false, U256::ZERO, reason_code, U256::from(now)));
        }

        // 2. Authoritative onchain call with multi-provider failover
        let _rpc_permit = self.try_rpc_permit()?;

        let contract = IPolicyEngine::new(self.config.policy_engine_address, self.provider.clone());
        match contract.evaluate(request.clone()).call().await {
            Ok(result) => {
                // Populate/refresh cache on success
                if let Ok(pol) = contract.getAgentPolicy(request.agent).call().await {
                    self.policy_cache.put_policy(
                        request.agent,
                        crate::policy_cache::CachedPolicyRecord {
                            max_per_tx: U256::from(pol.maxPerTx),
                            max_per_window: U256::from(pol.maxPerWindow),
                            window_seconds: pol.windowSeconds as u64,
                            max_velocity: pol.maxVelocity as u64,
                            kill_switch: pol.killSwitch,
                            whitelist_enabled: pol.whitelistEnabled,
                            cached_at: std::time::Instant::now(),
                        },
                    );
                }
                Ok((
                    result.allowed,
                    result.allowedAmount,
                    result.reasonCode,
                    result.evaluatedAtTimestamp,
                ))
            }
            Err(primary_err) => {
                warn!(error = %primary_err, "Primary Monad RPC provider failed during policy evaluation; testing fallback providers");
                for (i, fallback) in self.fallback_providers.iter().enumerate() {
                    let fallback_contract =
                        IPolicyEngine::new(self.config.policy_engine_address, fallback.clone());
                    if let Ok(result) = fallback_contract.evaluate(request.clone()).call().await {
                        info!(
                            fallback_index = i,
                            "Successfully recovered using fallback Monad RPC provider"
                        );
                        return Ok((
                            result.allowed,
                            result.allowedAmount,
                            result.reasonCode,
                            result.evaluatedAtTimestamp,
                        ));
                    }
                }
                Err(primary_err.to_string())
            }
        }
    }

    pub async fn agent_policy(&self, agent: Address) -> Result<AgentPolicy, String> {
        let _rpc_permit = self.try_rpc_permit()?;
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
        let _rpc_permit = self.try_rpc_permit()?;
        let contract = IPolicyEngine::new(self.config.policy_engine_address, self.provider.clone());
        contract
            .isMerchantWhitelisted(agent, merchant)
            .call()
            .await
            .map(|result| result._0)
            .map_err(|error| error.to_string())
    }

    pub async fn paymaster_sponsorship_eligibility(
        &self,
        agent: Address,
        max_cost: U256,
    ) -> Result<(bool, u8), String> {
        let _rpc_permit = self.try_rpc_permit()?;
        let contract =
            ICircuitPaymaster::new(self.config.circuit_paymaster_address, self.provider.clone());
        contract
            .isSponsorshipEligible(agent, max_cost)
            .call()
            .await
            .map(|result| (result.eligible, result.reasonCode))
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
        let Ok(_rpc_permit) = self.try_rpc_permit() else {
            return false;
        };
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
        let _rpc_permit = self.try_rpc_permit()?;
        let contract = IERC20Balance::new(token, self.provider.clone());
        contract
            .balanceOf(holder)
            .call()
            .await
            .map(|result| result._0)
            .map_err(|error| error.to_string())
    }

    pub async fn health_check(&self) -> Result<u64, String> {
        let _rpc_permit = self.try_rpc_permit()?;
        self.provider
            .get_block_number()
            .await
            .map_err(|error| error.to_string())
    }

    pub async fn verify_contracts(&self) -> Result<(), String> {
        let contracts = [
            ("PolicyEngine", self.config.policy_engine_address),
            (
                "ReputationRegistry",
                self.config.reputation_registry_address,
            ),
            ("AgentWalletGuard", self.config.agent_wallet_guard_address),
            ("CircuitPaymaster", self.config.circuit_paymaster_address),
            ("CircuitVault", self.config.circuit_vault_address),
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
        // Resolve the finalized head before asking for logs. The upper bound is deliberately
        // finite so a restarted indexer cannot issue an unbounded historical RPC query.
        let latest_hex: String = self.rpc("eth_blockNumber", json!([])).await?;
        let latest = parse_quantity(&latest_hex)
            .ok_or_else(|| "Monad RPC returned an invalid block number".to_string())?;
        let safe_head = latest.saturating_sub(self.config.event_finality_blocks);
        if from_block > safe_head {
            return Ok(None);
        }

        let to_block = from_block.saturating_add(999).min(safe_head);
        let logs: Vec<RpcLog> = self
            .rpc(
                "eth_getLogs",
                json!([{
                    "fromBlock": quantity(from_block),
                    "toBlock": quantity(to_block),
                    "address": [
                        format_address(self.config.policy_engine_address),
                        format_address(self.config.agent_wallet_guard_address),
                        format_address(self.config.circuit_paymaster_address),
                        format_address(self.config.circuit_vault_address),
                        format_address(self.config.reputation_registry_address),
                    ]
                }]),
            )
            .await?;

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
            .save_checkpoint(
                self.config.chain_id,
                to_block.saturating_add(1),
                &checkpoint_hash,
            )
            .await
            .map_err(|error| error.to_string())?;
        debug!(from_block, to_block, "Indexed finalized Monad logs");
        Ok(Some(to_block.saturating_add(1)))
    }

    pub fn check_dispute_finalization_readiness(current_block: u64, challenge_block: u64) -> bool {
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

    pub async fn rpc<T: for<'de> Deserialize<'de>>(
        &self,
        method: &str,
        params: Value,
    ) -> Result<T, String> {
        let _rpc_permit = self.try_rpc_permit()?;

        let mut candidate_urls = vec![&self.config.rpc_url];
        for fallback in &self.config.rpc_fallback_urls {
            candidate_urls.push(fallback);
        }

        let mut last_error = String::new();
        for (idx, target_url) in candidate_urls.iter().enumerate() {
            let res = self
                .http
                .post(*target_url)
                .json(&json!({
                    "jsonrpc": "2.0",
                    "id": 1,
                    "method": method,
                    "params": params.clone(),
                }))
                .send()
                .await;

            match res {
                Ok(response) => {
                    let status = response.status();
                    if let Ok(body) = response.json::<RpcResponse<T>>().await {
                        if !status.is_success() {
                            last_error =
                                format!("Monad RPC at {target_url} returned HTTP {status}");
                            continue;
                        }
                        if let Some(result) = body.result {
                            return Ok(result);
                        } else if let Some(error) = body.error {
                            return Err(error.message);
                        }
                    }
                }
                Err(err) => {
                    warn!(endpoint_index = idx, error = %err, "RPC candidate failed; trying fallback");
                    last_error = err.to_string();
                }
            }
        }

        Err(if last_error.is_empty() {
            "All Monad RPC endpoints exhausted".to_string()
        } else {
            last_error
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
        (
            "MerchantVoucherSubmitted(address,address,bytes32,uint128)",
            "MerchantVoucherSubmitted",
        ),
        ("GasSponsored(address,address,uint256)", "GasSponsored"),
        ("TreasuryDeposited(address,uint256)", "TreasuryDeposited"),
        ("TreasuryWithdrawn(address,uint256)", "TreasuryWithdrawn"),
        (
            "OutcomeRecorded(address,address,uint8,uint256,uint32)",
            "OutcomeRecorded",
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
