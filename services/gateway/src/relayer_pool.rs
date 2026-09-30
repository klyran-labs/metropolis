use alloy::primitives::Address;
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::{
    str::FromStr,
    sync::{
        atomic::{AtomicU64, AtomicUsize, Ordering},
        Arc, RwLock,
    },
};
use tracing::{debug, info};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum RelayerStatus {
    Active,
    Congested,
    Rebalancing,
}

#[derive(Debug)]
pub struct RelayerShard {
    pub id: usize,
    pub address: Address,
    pub private_key: Option<String>,
    pub current_nonce: AtomicU64,
    pub in_flight: AtomicUsize,
    pub escalation_count: AtomicU64,
    pub last_escalation_at: RwLock<Option<DateTime<Utc>>>,
    pub status: RwLock<RelayerStatus>,
}

impl RelayerShard {
    pub fn new(id: usize, address: Address, private_key: Option<String>) -> Self {
        Self {
            id,
            address,
            private_key,
            current_nonce: AtomicU64::new(0),
            in_flight: AtomicUsize::new(0),
            escalation_count: AtomicU64::new(0),
            last_escalation_at: RwLock::new(None),
            status: RwLock::new(RelayerStatus::Active),
        }
    }

    pub fn acquire_nonce(&self) -> u64 {
        self.in_flight.fetch_add(1, Ordering::SeqCst);
        self.current_nonce.fetch_add(1, Ordering::SeqCst)
    }

    pub fn release_in_flight(&self) {
        let prev = self.in_flight.fetch_sub(1, Ordering::SeqCst);
        if prev <= 1 {
            *self.status.write().unwrap() = RelayerStatus::Active;
        }
    }

    pub fn record_escalation(&self) {
        self.escalation_count.fetch_add(1, Ordering::SeqCst);
        *self.last_escalation_at.write().unwrap() = Some(Utc::now());
        if self.in_flight.load(Ordering::Relaxed) > 8 {
            *self.status.write().unwrap() = RelayerStatus::Congested;
        }
    }

    pub fn info(&self) -> RelayerShardInfo {
        let status = self.status.read().unwrap().clone();
        RelayerShardInfo {
            id: self.id,
            address: format!("{:#x}", self.address),
            current_nonce: self.current_nonce.load(Ordering::Relaxed),
            in_flight: self.in_flight.load(Ordering::Relaxed),
            escalation_count: self.escalation_count.load(Ordering::Relaxed),
            last_escalation_at: *self.last_escalation_at.read().unwrap(),
            status,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RelayerShardInfo {
    pub id: usize,
    pub address: String,
    pub current_nonce: u64,
    pub in_flight: usize,
    pub escalation_count: u64,
    pub last_escalation_at: Option<DateTime<Utc>>,
    pub status: RelayerStatus,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RelayerPoolStats {
    pub total_shards: usize,
    pub active_shards: usize,
    pub total_in_flight: usize,
    pub total_escalations: u64,
    pub shards: Vec<RelayerShardInfo>,
}

#[derive(Clone)]
pub struct RelayerPool {
    shards: Vec<Arc<RelayerShard>>,
    next_round_robin: Arc<AtomicUsize>,
}

impl RelayerPool {
    /// Creates a sharded pool with $M$ relayer partitions
    pub fn new(shards_config: Vec<(Address, Option<String>)>) -> Self {
        let mut shards = Vec::with_capacity(shards_config.len().max(1));
        if shards_config.is_empty() {
            // Default canonical sharded relayers for Monad devnet
            let default_addresses = [
                "0x70997970c51812dc3a010c7d01b50e0d17dc79c8",
                "0x3c44cdddb6a900fa2b585dd299e03d12fa4293bc",
                "0x90f79bf6eb2c4f870365e785982e1f101e93b906",
                "0x15d34aaf54267db7d7c367839aaf71a00a2c6a65",
            ];
            for (id, addr_str) in default_addresses.iter().enumerate() {
                let address = Address::from_str(addr_str).unwrap_or(Address::ZERO);
                shards.push(Arc::new(RelayerShard::new(id, address, None)));
            }
        } else {
            for (id, (address, key)) in shards_config.into_iter().enumerate() {
                shards.push(Arc::new(RelayerShard::new(id, address, key)));
            }
        }

        info!(total_shards = shards.len(), "Initialized sharded relayer pool for Monad Parallel EVM");
        Self {
            shards,
            next_round_robin: Arc::new(AtomicUsize::new(0)),
        }
    }

    /// Acquires the least-loaded relayer shard to eliminate head-of-line blocking
    pub fn acquire_least_loaded(&self) -> Arc<RelayerShard> {
        let mut best = &self.shards[0];
        let mut min_in_flight = best.in_flight.load(Ordering::Relaxed);

        for shard in &self.shards {
            let in_flight = shard.in_flight.load(Ordering::Relaxed);
            if in_flight < min_in_flight {
                min_in_flight = in_flight;
                best = shard;
            }
        }

        // If load is equal across all shards, use round-robin
        if min_in_flight > 0 {
            let idx = self.next_round_robin.fetch_add(1, Ordering::Relaxed) % self.shards.len();
            self.shards[idx].clone()
        } else {
            best.clone()
        }
    }

    /// Computes adaptive EIP-1559 priority fee escalation (+15% per escalation attempt)
    pub fn compute_escalated_tip(&self, base_tip_wei: u128, escalation_count: u32) -> u128 {
        if escalation_count == 0 {
            return base_tip_wei;
        }
        // tip = base * (1.15)^count
        let mut tip = base_tip_wei;
        for _ in 0..escalation_count.min(10) {
            tip = tip.saturating_mul(115) / 100;
        }
        debug!(base_tip = base_tip_wei, escalation_count, escalated_tip = tip, "Computed adaptive EIP-1559 priority fee");
        tip
    }

    pub fn stats(&self) -> RelayerPoolStats {
        let mut total_in_flight = 0;
        let mut total_escalations = 0;
        let mut active_shards = 0;
        let mut shard_infos = Vec::with_capacity(self.shards.len());

        for shard in &self.shards {
            let info = shard.info();
            total_in_flight += info.in_flight;
            total_escalations += info.escalation_count;
            if info.status == RelayerStatus::Active {
                active_shards += 1;
            }
            shard_infos.push(info);
        }

        RelayerPoolStats {
            total_shards: self.shards.len(),
            active_shards,
            total_in_flight,
            total_escalations,
            shards: shard_infos,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_relayer_pool_round_robin_and_least_loaded() {
        let shards = vec![
            (Address::repeat_byte(1), None),
            (Address::repeat_byte(2), None),
            (Address::repeat_byte(3), None),
        ];
        let pool = RelayerPool::new(shards);

        let shard_a = pool.acquire_least_loaded();
        assert_eq!(shard_a.id, 0);
        let nonce = shard_a.acquire_nonce();
        assert_eq!(nonce, 0);
        assert_eq!(shard_a.in_flight.load(Ordering::SeqCst), 1);

        // Next acquire selects shard 1 because it has 0 in-flight
        let shard_b = pool.acquire_least_loaded();
        assert_eq!(shard_b.id, 1);
    }

    #[test]
    fn test_adaptive_eip1559_tip_escalation() {
        let pool = RelayerPool::new(vec![]);
        let base_tip = 1_000_000_000u128; // 1 Gwei
        assert_eq!(pool.compute_escalated_tip(base_tip, 0), base_tip);

        // Escalation 1: +15% -> 1.15 Gwei
        assert_eq!(pool.compute_escalated_tip(base_tip, 1), 1_150_000_000);

        // Escalation 2: 1.15 * 1.15 -> 1.3225 Gwei
        assert_eq!(pool.compute_escalated_tip(base_tip, 2), 1_322_500_000);
    }
}
