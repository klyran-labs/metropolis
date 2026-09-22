use std::{
    collections::HashMap,
    sync::{Arc, Mutex},
};
use tokio::sync::{OwnedSemaphorePermit, Semaphore};

/// Bounded per-tenant admission control. The semaphore is acquired without waiting so a noisy
/// tenant fails fast instead of turning queueing into unbounded tail latency for every tenant.
#[derive(Clone)]
pub struct TenantConcurrency {
    per_tenant_limit: usize,
    max_tracked_tenants: usize,
    slots: Arc<Mutex<TenantSlots>>,
}

struct TenantSlot {
    semaphore: Arc<Semaphore>,
    last_used: u64,
}

struct TenantSlots {
    entries: HashMap<String, TenantSlot>,
    clock: u64,
}

impl TenantConcurrency {
    pub fn new(per_tenant_limit: usize, max_tracked_tenants: usize) -> Result<Self, String> {
        if per_tenant_limit == 0 || max_tracked_tenants == 0 {
            return Err("Tenant concurrency limits must be positive".to_string());
        }
        Ok(Self {
            per_tenant_limit,
            max_tracked_tenants,
            slots: Arc::new(Mutex::new(TenantSlots {
                entries: HashMap::new(),
                clock: 0,
            })),
        })
    }

    pub fn try_acquire(&self, tenant_id: &str) -> Option<OwnedSemaphorePermit> {
        let mut slots = self
            .slots
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        slots.clock = slots.clock.wrapping_add(1);
        let now = slots.clock;

        if let Some(slot) = slots.entries.get_mut(tenant_id) {
            slot.last_used = now;
            return Arc::clone(&slot.semaphore).try_acquire_owned().ok();
        }

        if slots.entries.len() >= self.max_tracked_tenants {
            let idle_key = slots
                .entries
                .iter()
                .filter(|(_, slot)| slot.semaphore.available_permits() == self.per_tenant_limit)
                .min_by_key(|(_, slot)| slot.last_used)
                .map(|(key, _)| key.clone());
            let idle_key = idle_key?;
            slots.entries.remove(&idle_key);
        }

        let slot = Arc::new(Semaphore::new(self.per_tenant_limit));
        slots.entries.insert(
            tenant_id.to_string(),
            TenantSlot {
                semaphore: Arc::clone(&slot),
                last_used: now,
            },
        );
        slot.try_acquire_owned().ok()
    }
}

#[cfg(test)]
mod tests {
    use super::TenantConcurrency;

    #[test]
    fn rejects_invalid_limits() {
        assert!(TenantConcurrency::new(0, 1).is_err());
        assert!(TenantConcurrency::new(1, 0).is_err());
    }

    #[test]
    fn isolates_tenants_and_fails_fast() {
        let limits = TenantConcurrency::new(1, 2).expect("valid limits");
        let first = limits.try_acquire("org-a").expect("first permit");
        assert!(limits.try_acquire("org-a").is_none());
        assert!(limits.try_acquire("org-b").is_some());
        drop(first);
        assert!(limits.try_acquire("org-a").is_some());
    }

    #[test]
    fn evicts_idle_slots_when_the_tracking_bound_is_reached() {
        let limits = TenantConcurrency::new(1, 1).expect("valid limits");
        let first = limits.try_acquire("org-a").expect("first permit");
        drop(first);
        assert!(limits.try_acquire("org-b").is_some());
        assert!(limits.try_acquire("org-a").is_some());
    }
}
