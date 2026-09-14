use alloy::primitives::Address;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct TenantContext {
    pub org_id: String,
    pub enterprise_address: Address,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TenantAgentKey {
    pub org_id: String,
    pub agent: Address,
}

impl TenantContext {
    pub fn owns(&self, org_id: &str) -> bool {
        self.org_id == org_id
    }

    pub fn agent_key(&self, agent: Address) -> TenantAgentKey {
        TenantAgentKey {
            org_id: self.org_id.clone(),
            agent,
        }
    }
}
