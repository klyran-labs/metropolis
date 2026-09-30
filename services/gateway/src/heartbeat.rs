use serde::{Deserialize, Serialize};
use std::{collections::HashMap, sync::RwLock};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentHeartbeatRequest {
    pub agent: String,
    pub timestamp: u64,
    pub signature: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentLivenessStatus {
    pub agent: String,
    pub last_heartbeat: u64,
    pub status: String, // "HEALTHY", "WARNING_INACTIVE", "SUCCESSION_TRIGGERED"
    pub seconds_since_last_heartbeat: u64,
    pub grace_period_seconds: u64,
    pub standby_key: String,
    pub fallback_treasury: String,
    pub succession_active: bool,
}

#[derive(Debug, Default)]
pub struct HeartbeatManager {
    records: RwLock<HashMap<String, AgentLivenessStatus>>,
}

impl HeartbeatManager {
    pub fn new() -> Self {
        Self {
            records: RwLock::new(HashMap::new()),
        }
    }

    pub fn record_heartbeat(&self, req: AgentHeartbeatRequest) -> AgentLivenessStatus {
        let mut map = self.records.write().unwrap();
        let current_time = req.timestamp;

        let status = map.entry(req.agent.to_lowercase()).or_insert_with(|| AgentLivenessStatus {
            agent: req.agent.clone(),
            last_heartbeat: current_time,
            status: "HEALTHY".to_string(),
            seconds_since_last_heartbeat: 0,
            grace_period_seconds: 259_200, // 72 hours default
            standby_key: "0x0000000000000000000000000000000000000000".to_string(),
            fallback_treasury: "0x0000000000000000000000000000000000000000".to_string(),
            succession_active: false,
        });

        status.last_heartbeat = current_time;
        status.seconds_since_last_heartbeat = 0;
        status.status = "HEALTHY".to_string();
        status.succession_active = false;

        status.clone()
    }

    pub fn get_status(&self, agent: &str, current_time: u64) -> AgentLivenessStatus {
        let map = self.records.read().unwrap();
        if let Some(record) = map.get(&agent.to_lowercase()) {
            let mut res = record.clone();
            let elapsed = current_time.saturating_sub(res.last_heartbeat);
            res.seconds_since_last_heartbeat = elapsed;

            if res.succession_active {
                res.status = "SUCCESSION_ACTIVE".to_string();
            } else if elapsed >= res.grace_period_seconds {
                res.status = "SUCCESSION_PENDING".to_string();
            } else if elapsed >= res.grace_period_seconds / 2 {
                res.status = "WARNING_INACTIVE".to_string();
            } else {
                res.status = "HEALTHY".to_string();
            }
            res
        } else {
            AgentLivenessStatus {
                agent: agent.to_string(),
                last_heartbeat: current_time,
                status: "HEALTHY".to_string(),
                seconds_since_last_heartbeat: 0,
                grace_period_seconds: 259_200,
                standby_key: "0x0000000000000000000000000000000000000000".to_string(),
                fallback_treasury: "0x0000000000000000000000000000000000000000".to_string(),
                succession_active: false,
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_record_and_evaluate_heartbeat() {
        let mgr = HeartbeatManager::new();
        let agent = "0xAgent001".to_string();

        let initial = mgr.record_heartbeat(AgentHeartbeatRequest {
            agent: agent.clone(),
            timestamp: 1000,
            signature: None,
        });
        assert_eq!(initial.status, "HEALTHY");

        // 1000s later (within 72h grace)
        let status = mgr.get_status(&agent, 2000);
        assert_eq!(status.status, "HEALTHY");
        assert_eq!(status.seconds_since_last_heartbeat, 1000);

        // 300,000s later (beyond 259,200s grace period)
        let expired = mgr.get_status(&agent, 301_000);
        assert_eq!(expired.status, "SUCCESSION_PENDING");
    }
}
