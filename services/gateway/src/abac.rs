use crate::{auth::RequestContext, error::AccessReasonCode};
use alloy::primitives::U256;
use chrono::{Datelike, Timelike, Utc};
use ipnet::IpNet;
use serde::{Deserialize, Serialize};
use std::net::IpAddr;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AgentEnvironment {
    Production,
    Staging,
    Sandbox,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RiskTier {
    Tier1Critical,
    Tier2Standard,
    Tier3Test,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AbacPolicy {
    #[serde(default)]
    pub allowed_cidrs: Vec<IpNet>,
    #[serde(default)]
    pub require_mfa: bool,
    #[serde(default)]
    pub max_amount: Option<U256>,
    #[serde(default)]
    pub max_gas_price: Option<U256>,
    #[serde(default = "default_start_hour")]
    pub trading_start_hour_utc: u8,
    #[serde(default = "default_end_hour")]
    pub trading_end_hour_utc: u8,
    #[serde(default)]
    pub allowed_environments: Vec<AgentEnvironment>,
    #[serde(default)]
    pub blocked_risk_tiers: Vec<RiskTier>,
}

const fn default_start_hour() -> u8 {
    0
}
const fn default_end_hour() -> u8 {
    24
}

#[derive(Debug, Clone, Copy)]
pub struct AbacContext {
    pub client_ip: IpAddr,
    pub amount: Option<U256>,
    pub gas_price: Option<U256>,
    pub environment: AgentEnvironment,
    pub risk_tier: RiskTier,
    pub now: chrono::DateTime<Utc>,
}

pub fn evaluate(
    policy: &AbacPolicy,
    request: &RequestContext,
    context: AbacContext,
) -> Result<(), AccessReasonCode> {
    if policy.require_mfa && !request.mfa_authenticated {
        return Err(AccessReasonCode::MfaRequired);
    }

    if !policy.allowed_cidrs.is_empty()
        && !policy
            .allowed_cidrs
            .iter()
            .any(|cidr| cidr.contains(&context.client_ip))
    {
        return Err(AccessReasonCode::IpNotAllowed);
    }

    if let (Some(max), Some(amount)) = (policy.max_amount, context.amount)
        && amount > max
    {
        return Err(AccessReasonCode::PolicyDenied);
    }

    if let (Some(max), Some(gas_price)) = (policy.max_gas_price, context.gas_price)
        && gas_price > max
    {
        return Err(AccessReasonCode::EnvironmentDenied);
    }

    if !policy.allowed_environments.is_empty()
        && !policy.allowed_environments.contains(&context.environment)
    {
        return Err(AccessReasonCode::EnvironmentDenied);
    }

    if policy.blocked_risk_tiers.contains(&context.risk_tier) {
        return Err(AccessReasonCode::EnvironmentDenied);
    }

    let hour = context.now.hour() as u8;
    let start = policy.trading_start_hour_utc;
    let end = policy.trading_end_hour_utc;
    let in_window = if start <= end {
        hour >= start && hour < end
    } else {
        hour >= start || hour < end
    };
    if !in_window {
        return Err(AccessReasonCode::EnvironmentDenied);
    }

    let _ = context.now.weekday();
    Ok(())
}
