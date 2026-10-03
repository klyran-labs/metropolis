use alloy::primitives::{Address, U256};
use dashmap::DashMap;
use std::collections::HashMap;
use std::time::{Duration, Instant};

/// Tracks in-flight and recently leased nonces to prevent concurrent race collisions
/// within the same Monad 400ms block window using sharded lock-free concurrency.
#[derive(Debug)]
pub struct NonceSequencer {
    // agent -> (nonce -> lease_timestamp) sharded by agent address
    in_flight: DashMap<Address, HashMap<U256, Instant>>,
    lease_ttl: Duration,
}

impl Default for NonceSequencer {
    fn default() -> Self {
        Self::new(5_000) // default 5-second lease window
    }
}

impl NonceSequencer {
    pub fn new(lease_ttl_ms: u64) -> Self {
        Self {
            in_flight: DashMap::new(),
            lease_ttl: Duration::from_millis(lease_ttl_ms),
        }
    }

    /// Attempts to reserve a nonce for an agent with zero cross-agent thread lock contention.
    /// Returns Ok(()) if the nonce is fresh and reserved.
    /// Returns Err(OnchainReasonCode::NonceReused) if the nonce is currently leased or was recently consumed.
    pub fn try_acquire_nonce(&self, agent: Address, nonce: U256) -> Result<(), u8> {
        let now = Instant::now();
        let mut agent_nonces = self.in_flight.entry(agent).or_default();

        // Prune expired leases
        agent_nonces.retain(|_, leased_at| now.duration_since(*leased_at) < self.lease_ttl);

        if agent_nonces.contains_key(&nonce) {
            // Already in flight or leased in current window
            return Err(8); // OnchainReasonCode::NonceReused (8)
        }

        agent_nonces.insert(nonce, now);
        Ok(())
    }

    /// Releases a reserved nonce (e.g. if the request was rejected by policy or signature check).
    pub fn release_nonce(&self, agent: Address, nonce: U256) {
        if let Some(mut agent_nonces) = self.in_flight.get_mut(&agent) {
            agent_nonces.remove(&nonce);
        }
    }

    /// Returns the number of currently active in-flight leases across all agents.
    pub fn active_leases_count(&self) -> usize {
        self.in_flight.iter().map(|entry| entry.value().len()).sum()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_nonce_sequencer_acquire_and_collision() {
        let sequencer = NonceSequencer::new(500);
        let agent = Address::repeat_byte(0x42);
        let nonce = U256::from(1);

        // First acquisition succeeds
        assert!(sequencer.try_acquire_nonce(agent, nonce).is_ok());

        // Concurrent acquisition with same nonce fails immediately with reason code 8
        let second = sequencer.try_acquire_nonce(agent, nonce);
        assert_eq!(second, Err(8));

        // Different nonce for same agent succeeds
        let nonce2 = U256::from(2);
        assert!(sequencer.try_acquire_nonce(agent, nonce2).is_ok());

        // Same nonce for different agent succeeds
        let other_agent = Address::repeat_byte(0x99);
        assert!(sequencer.try_acquire_nonce(other_agent, nonce).is_ok());

        // Release allows re-acquisition
        sequencer.release_nonce(agent, nonce);
        assert!(sequencer.try_acquire_nonce(agent, nonce).is_ok());
    }
}
