use crate::{auth::RequestContext, error::AccessReasonCode, rbac::Role};
use alloy::primitives::U256;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum PolicyEffect {
    Allow,
    Deny,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PbacConditions {
    pub max_amount: Option<U256>,
    pub required_multisig_signatures: Option<u8>,
    #[serde(default)]
    pub eligible_approver_roles: Vec<Role>,
    pub require_mfa: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PbacPolicy {
    pub id: Uuid,
    pub org_id: String,
    pub version: i64,
    pub effect: PolicyEffect,
    #[serde(default)]
    pub principals: Vec<String>,
    #[serde(default)]
    pub actions: Vec<String>,
    #[serde(default)]
    pub resources: Vec<String>,
    #[serde(default)]
    pub conditions: PbacConditions,
}

#[derive(Debug, Clone)]
pub struct PbacInput<'a> {
    pub action: &'a str,
    pub resource: &'a str,
    pub amount: Option<U256>,
    pub approval_count: u8,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PbacDecision {
    pub allowed: bool,
    pub policy_id: Option<Uuid>,
    pub policy_version: Option<i64>,
    pub reason_code: Option<AccessReasonCode>,
}

pub fn evaluate(
    policies: &[PbacPolicy],
    context: &RequestContext,
    input: PbacInput<'_>,
) -> PbacDecision {
    let mut matched_allow: Option<&PbacPolicy> = None;

    for policy in policies
        .iter()
        .filter(|policy| policy.org_id == context.tenant.org_id)
    {
        if !matches_any(&policy.principals, &context.subject)
            || !matches_any(&policy.actions, input.action)
            || !matches_any(&policy.resources, input.resource)
        {
            continue;
        }

        if policy.effect == PolicyEffect::Deny {
            if !conditions_match(
                &policy.conditions,
                context,
                input.amount,
                input.approval_count,
            ) {
                continue;
            }
            return PbacDecision {
                allowed: false,
                policy_id: Some(policy.id),
                policy_version: Some(policy.version),
                reason_code: Some(AccessReasonCode::PolicyDenied),
            };
        }

        if !conditions_match(
            &policy.conditions,
            context,
            input.amount,
            input.approval_count,
        ) {
            return PbacDecision {
                allowed: false,
                policy_id: Some(policy.id),
                policy_version: Some(policy.version),
                reason_code: Some(condition_failure_reason(
                    &policy.conditions,
                    context,
                    input.approval_count,
                )),
            };
        }

        matched_allow = Some(policy);
    }

    match matched_allow {
        Some(policy) => PbacDecision {
            allowed: true,
            policy_id: Some(policy.id),
            policy_version: Some(policy.version),
            reason_code: None,
        },
        None => PbacDecision {
            allowed: true,
            policy_id: None,
            policy_version: None,
            reason_code: None,
        },
    }
}

fn condition_failure_reason(
    conditions: &PbacConditions,
    context: &RequestContext,
    approval_count: u8,
) -> AccessReasonCode {
    if conditions.require_mfa == Some(true) && !context.mfa_authenticated {
        return AccessReasonCode::MfaRequired;
    }
    if conditions
        .required_multisig_signatures
        .is_some_and(|required| approval_count < required)
    {
        return AccessReasonCode::ApprovalRequired;
    }
    AccessReasonCode::PolicyDenied
}

fn conditions_match(
    conditions: &PbacConditions,
    context: &RequestContext,
    amount: Option<U256>,
    approval_count: u8,
) -> bool {
    if let Some(max_amount) = conditions.max_amount
        && amount.is_none_or(|value| value > max_amount)
    {
        return false;
    }

    if let Some(required) = conditions.required_multisig_signatures
        && approval_count < required
    {
        return false;
    }

    if !conditions.eligible_approver_roles.is_empty()
        && !conditions.eligible_approver_roles.contains(&context.role)
    {
        return false;
    }

    conditions.require_mfa != Some(true) || context.mfa_authenticated
}

fn matches_any(patterns: &[String], value: &str) -> bool {
    patterns.is_empty() || patterns.iter().any(|pattern| glob_matches(pattern, value))
}

fn glob_matches(pattern: &str, value: &str) -> bool {
    if pattern == "*" {
        return true;
    }
    if let Some(prefix) = pattern.strip_suffix('*') {
        return value.starts_with(prefix);
    }
    pattern == value
}

use uuid::Uuid;
