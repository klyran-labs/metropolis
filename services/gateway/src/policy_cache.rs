use crate::types::{OnchainReasonCode, SpendRequest};
use alloy::primitives::{Address, U256};
use dashmap::DashMap;
use std::time::{Duration, Instant};

#[derive(Clone, Debug)]
pub struct CachedPolicyRecord {
    pub max_per_tx: U256,
    pub max_per_window: U256,
    pub window_seconds: u64,
    pub max_velocity: u64,
    pub kill_switch: bool,
    pub whitelist_enabled: bool,
    pub cached_at: Instant,
}

#[derive(Debug)]
pub struct PolicyEngineCache {
    policies: DashMap<Address, CachedPolicyRecord>,
    whitelists: DashMap<(Address, Address), (bool, Instant)>,
    ttl: Duration,
}

impl Default for PolicyEngineCache {
    fn default() -> Self {
        Self::new(3_000) // Default 3-second cache TTL
    }
}

impl PolicyEngineCache {
    pub fn new(ttl_ms: u64) -> Self {
        Self {
            policies: DashMap::new(),
            whitelists: DashMap::new(),
            ttl: Duration::from_millis(ttl_ms),
        }
    }

    /// Stores a policy returned from onchain read in memory without global write-lock contention.
    pub fn put_policy(&self, agent: Address, record: CachedPolicyRecord) {
        self.policies.insert(agent, record);
    }

    /// Stores merchant whitelist authorization in memory without global write-lock contention.
    pub fn put_merchant_whitelist(&self, agent: Address, merchant: Address, allowed: bool) {
        self.whitelists.insert((agent, merchant), (allowed, Instant::now()));
    }

    /// Invalidates an agent's policy (e.g. upon detecting an onchain PolicyUpdated event).
    pub fn invalidate_agent(&self, agent: &Address) {
        self.policies.remove(agent);
        self.whitelists.retain(|(a, _), _| a != agent);
    }

    /// Retrieves cached policy if within TTL using lock-free sharded read path.
    pub fn get_policy(&self, agent: &Address) -> Option<CachedPolicyRecord> {
        let record = self.policies.get(agent)?;
        if Instant::now().duration_since(record.cached_at) < self.ttl {
            Some(record.clone())
        } else {
            None
        }
    }

    /// Fast-path policy evaluation executed purely in-memory (<1 microsecond).
    /// Returns Some((allowed, reason_code)) if deterministic resolution is possible offchain.
    /// Returns None if an authoritative onchain eth_call is necessary (e.g. cache miss, window arithmetic check).
    pub fn evaluate_fast_path(&self, request: &SpendRequest) -> Option<(bool, u8)> {
        let policy = self.get_policy(&request.agent)?;

        // 1. O(1) Kill Switch Check
        if policy.kill_switch {
            return Some((false, OnchainReasonCode::KillSwitch.as_u8()));
        }

        // 2. Transaction Spend Ceiling Check
        if request.amount > policy.max_per_tx {
            return Some((false, OnchainReasonCode::MaxPerTx.as_u8()));
        }

        // 3. Merchant Whitelist Check
        if policy.whitelist_enabled {
            match self.whitelists.get(&(request.agent, request.merchant)) {
                Some(entry) if Instant::now().duration_since(entry.1) < self.ttl => {
                    if !entry.0 {
                        return Some((false, OnchainReasonCode::MerchantNotAllowed.as_u8()));
                    }
                }
                _ => return None,
            }
        }

        // If amount exceeds maxPerWindow, it's also an immediate denial
        if request.amount > policy.max_per_window {
            return Some((false, OnchainReasonCode::MaxPerWindow.as_u8()));
        }

        // For transactions within individual ceilings, return None so the authoritative
        // onchain rolling window state can be updated/verified.
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_policy_cache_fast_path_kill_switch() {
        let cache = PolicyEngineCache::new(5_000);
        let agent = Address::repeat_byte(0x11);
        let merchant = Address::repeat_byte(0x22);

        cache.put_policy(
            agent,
            CachedPolicyRecord {
                max_per_tx: U256::from(100),
                max_per_window: U256::from(1000),
                window_seconds: 3600,
                max_velocity: 10,
                kill_switch: true, // kill switch active!
                whitelist_enabled: false,
                cached_at: Instant::now(),
            },
        );

        let req = SpendRequest {
            agent,
            merchant,
            amount: U256::from(50),
            category: [0u8; 32].into(),
            timestamp: U256::from(1000),
            deadline: U256::from(2000),
            nonce: U256::from(0),
        };

        let result = cache.evaluate_fast_path(&req);
        assert_eq!(result, Some((false, OnchainReasonCode::KillSwitch.as_u8())));
    }

    #[test]
    fn test_policy_cache_fast_path_max_per_tx() {
        let cache = PolicyEngineCache::new(5_000);
        let agent = Address::repeat_byte(0x11);
        let merchant = Address::repeat_byte(0x22);

        cache.put_policy(
            agent,
            CachedPolicyRecord {
                max_per_tx: U256::from(100),
                max_per_window: U256::from(1000),
                window_seconds: 3600,
                max_velocity: 10,
                kill_switch: false,
                whitelist_enabled: false,
                cached_at: Instant::now(),
            },
        );

        let req = SpendRequest {
            agent,
            merchant,
            amount: U256::from(150), // exceeds max_per_tx (100)
            category: [0u8; 32].into(),
            timestamp: U256::from(1000),
            deadline: U256::from(2000),
            nonce: U256::from(0),
        };

        let result = cache.evaluate_fast_path(&req);
        assert_eq!(result, Some((false, OnchainReasonCode::MaxPerTx.as_u8())));
    }
}
