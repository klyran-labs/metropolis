//! FinOps Dual-Denomination Engine & Enterprise Rate Cards (ADR 0010)
//!
//! Implements multi-tenant spend calculations across:
//! 1. Flat Custom Discount (e.g., negotiated 20% off list prices)
//! 2. Tiered Volume Ladders (graduated brackets based on cumulative monthly volume)
//! 3. Committed-Use / PTUs (sunk capacity with marginal $0 cost inside quota and overage firewalling)
//!
//! All calculations are dual-denominated: exact token tracking + exact micro-dollar (USDC 6 decimals)
//! base units.

use crate::types::{
    FinOpsSpendResult, ModelRateOverride, PricingModelType, TenantPricingModel,
    UpdatePricingModelRequest,
};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// Standard Model Rate per 1,000,000 tokens in micro-dollars (1 USD = 1,000,000 micro-dollars / USDC base units)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModelCatalogEntry {
    pub provider: String,
    #[serde(rename = "modelId")]
    pub model_id: String,
    #[serde(rename = "displayName")]
    pub display_name: String,
    /// Cost per 1M input tokens in micro-dollars (e.g. $3.00 = 3_000_000)
    #[serde(rename = "inputPerMMicroDollars")]
    pub input_per_m_micro_dollars: u64,
    /// Cost per 1M output tokens in micro-dollars (e.g. $15.00 = 15_000_000)
    #[serde(rename = "outputPerMMicroDollars")]
    pub output_per_m_micro_dollars: u64,
    /// Cost per 1M cache read tokens in micro-dollars (e.g. $0.30 = 300_000)
    #[serde(rename = "cacheReadPerMMicroDollars")]
    pub cache_read_per_m_micro_dollars: u64,
    /// Cost per 1M cache creation tokens in micro-dollars (e.g. $3.75 = 3_750_000)
    #[serde(rename = "cacheWritePerMMicroDollars")]
    pub cache_write_per_m_micro_dollars: u64,
}

/// Returns the official catalog of foundation model list prices
pub fn get_official_catalog() -> Vec<ModelCatalogEntry> {
    vec![
        ModelCatalogEntry {
            provider: "anthropic".to_string(),
            model_id: "claude-3-7-sonnet".to_string(),
            display_name: "Claude 3.7 Sonnet".to_string(),
            input_per_m_micro_dollars: 3_000_000,
            output_per_m_micro_dollars: 15_000_000,
            cache_read_per_m_micro_dollars: 300_000,
            cache_write_per_m_micro_dollars: 3_750_000,
        },
        ModelCatalogEntry {
            provider: "anthropic".to_string(),
            model_id: "claude-3-5-sonnet".to_string(),
            display_name: "Claude 3.5 Sonnet".to_string(),
            input_per_m_micro_dollars: 3_000_000,
            output_per_m_micro_dollars: 15_000_000,
            cache_read_per_m_micro_dollars: 300_000,
            cache_write_per_m_micro_dollars: 3_750_000,
        },
        ModelCatalogEntry {
            provider: "anthropic".to_string(),
            model_id: "claude-3-5-haiku".to_string(),
            display_name: "Claude 3.5 Haiku".to_string(),
            input_per_m_micro_dollars: 800_000,
            output_per_m_micro_dollars: 4_000_000,
            cache_read_per_m_micro_dollars: 80_000,
            cache_write_per_m_micro_dollars: 1_000_000,
        },
        ModelCatalogEntry {
            provider: "openai".to_string(),
            model_id: "gpt-4o".to_string(),
            display_name: "GPT-4o".to_string(),
            input_per_m_micro_dollars: 2_500_000,
            output_per_m_micro_dollars: 10_000_000,
            cache_read_per_m_micro_dollars: 1_250_000,
            cache_write_per_m_micro_dollars: 2_500_000,
        },
        ModelCatalogEntry {
            provider: "openai".to_string(),
            model_id: "gpt-4o-mini".to_string(),
            display_name: "GPT-4o mini".to_string(),
            input_per_m_micro_dollars: 150_000,
            output_per_m_micro_dollars: 600_000,
            cache_read_per_m_micro_dollars: 75_000,
            cache_write_per_m_micro_dollars: 150_000,
        },
        ModelCatalogEntry {
            provider: "openai".to_string(),
            model_id: "o3-mini".to_string(),
            display_name: "o3-mini (Reasoning)".to_string(),
            input_per_m_micro_dollars: 1_100_000,
            output_per_m_micro_dollars: 4_400_000,
            cache_read_per_m_micro_dollars: 550_000,
            cache_write_per_m_micro_dollars: 1_100_000,
        },
        ModelCatalogEntry {
            provider: "deepseek".to_string(),
            model_id: "deepseek-v3".to_string(),
            display_name: "DeepSeek V3".to_string(),
            input_per_m_micro_dollars: 270_000,
            output_per_m_micro_dollars: 1_100_000,
            cache_read_per_m_micro_dollars: 70_000,
            cache_write_per_m_micro_dollars: 270_000,
        },
        ModelCatalogEntry {
            provider: "deepseek".to_string(),
            model_id: "deepseek-r1".to_string(),
            display_name: "DeepSeek R1 (Reasoning)".to_string(),
            input_per_m_micro_dollars: 550_000,
            output_per_m_micro_dollars: 2_190_000,
            cache_read_per_m_micro_dollars: 140_000,
            cache_write_per_m_micro_dollars: 550_000,
        },
        ModelCatalogEntry {
            provider: "alibaba".to_string(),
            model_id: "qwen-max".to_string(),
            display_name: "Qwen Max".to_string(),
            input_per_m_micro_dollars: 2_400_000,
            output_per_m_micro_dollars: 9_600_000,
            cache_read_per_m_micro_dollars: 600_000,
            cache_write_per_m_micro_dollars: 2_400_000,
        },
        ModelCatalogEntry {
            provider: "alibaba".to_string(),
            model_id: "qwen-plus".to_string(),
            display_name: "Qwen Plus".to_string(),
            input_per_m_micro_dollars: 400_000,
            output_per_m_micro_dollars: 1_200_000,
            cache_read_per_m_micro_dollars: 100_000,
            cache_write_per_m_micro_dollars: 400_000,
        },
    ]
}

/// Official catalog of autonomous agent external tools & non-token APIs (ADR-0010 Section 1)
pub fn get_official_tool_catalog() -> Vec<crate::types::ToolCatalogEntry> {
    vec![
        crate::types::ToolCatalogEntry {
            tool_id: "serper-search".to_string(),
            display_name: "Serper Web Search".to_string(),
            provider: "Google Serper".to_string(),
            category: "Search".to_string(),
            cost_per_call_micro_dollars: 1_000, // $0.001 per query
        },
        crate::types::ToolCatalogEntry {
            tool_id: "firecrawl-scrape".to_string(),
            display_name: "Firecrawl Web Scraper".to_string(),
            provider: "Firecrawl".to_string(),
            category: "Scraping".to_string(),
            cost_per_call_micro_dollars: 2_000, // $0.002 per page
        },
        crate::types::ToolCatalogEntry {
            tool_id: "tavily-search".to_string(),
            display_name: "Tavily AI Search".to_string(),
            provider: "Tavily".to_string(),
            category: "Search".to_string(),
            cost_per_call_micro_dollars: 5_000, // $0.005 per query
        },
        crate::types::ToolCatalogEntry {
            tool_id: "e2b-sandbox".to_string(),
            display_name: "E2B Code Sandbox".to_string(),
            provider: "E2B".to_string(),
            category: "Code Execution".to_string(),
            cost_per_call_micro_dollars: 10_000, // $0.010 per minute
        },
        crate::types::ToolCatalogEntry {
            tool_id: "custom-rpc".to_string(),
            display_name: "Custom Webhook / RPC Tool".to_string(),
            provider: "Self-Hosted".to_string(),
            category: "Integration".to_string(),
            cost_per_call_micro_dollars: 500, // $0.0005 per invocation
        },
    ]
}

/// Calculates tool spend for non-token tool execution requests (ADR 0010 Section 1)
pub fn calculate_tool_spend(tool_id: &str, call_count: u64, pricing: &TenantPricingModel) -> u64 {
    let rate_per_call = if let Some(override_rate) = pricing.tool_custom_rates.get(tool_id) {
        override_rate.cost_per_call_micro_dollars
    } else {
        match tool_id {
            "serper-search" => 1_000,
            "firecrawl-scrape" => 2_000,
            "tavily-search" => 5_000,
            "e2b-sandbox" => 10_000,
            _ => 500,
        }
    };
    call_count.saturating_mul(rate_per_call)
}

pub fn validate_pricing_model(request: &UpdatePricingModelRequest) -> Result<(), &'static str> {
    if request.discount_bps > 10_000 {
        return Err("The pricing discount cannot exceed 10000 basis points.");
    }
    if request
        .volume_tiers
        .windows(2)
        .any(|tiers| tiers[0].min_tokens >= tiers[1].min_tokens)
    {
        return Err("Pricing volume tiers must be strictly ordered by token volume.");
    }
    if request
        .volume_tiers
        .iter()
        .any(|tier| tier.discount_bps > 10_000)
    {
        return Err("A pricing volume tier cannot exceed 10000 basis points.");
    }
    for rate in request.custom_rates.values() {
        if rate.cache_write_per_m_micro_dollars.is_none()
            && rate.input_per_m_micro_dollars.checked_mul(125).is_none()
        {
            return Err("A custom model rate overflows its derived cache-write rate.");
        }
    }
    Ok(())
}

/// Find a configured custom rate or an official catalog entry. Unknown models are rejected.
pub fn resolve_model_rates(
    model_id: &str,
    custom_rates: &HashMap<String, ModelRateOverride>,
) -> Option<(u64, u64, u64, u64)> {
    if let Some(override_rate) = custom_rates.get(model_id) {
        return Some((
            override_rate.input_per_m_micro_dollars,
            override_rate.output_per_m_micro_dollars,
            override_rate
                .cache_read_per_m_micro_dollars
                .unwrap_or(override_rate.input_per_m_micro_dollars / 10),
            override_rate
                .cache_write_per_m_micro_dollars
                .unwrap_or((override_rate.input_per_m_micro_dollars * 125) / 100),
        ));
    }

    type CatalogRow = (&'static str, u64, u64, u64, u64);
    static CATALOG: std::sync::OnceLock<[CatalogRow; 10]> = std::sync::OnceLock::new();
    let catalog = CATALOG.get_or_init(|| {
        [
            (
                "claude-3-7-sonnet",
                3_000_000,
                15_000_000,
                300_000,
                3_750_000,
            ),
            (
                "claude-3-5-sonnet",
                3_000_000,
                15_000_000,
                300_000,
                3_750_000,
            ),
            ("claude-3-5-haiku", 800_000, 4_000_000, 80_000, 1_000_000),
            ("gpt-4o", 2_500_000, 10_000_000, 1_250_000, 2_500_000),
            ("gpt-4o-mini", 150_000, 600_000, 75_000, 150_000),
            ("o3-mini", 1_100_000, 4_400_000, 550_000, 1_100_000),
            ("deepseek-v3", 270_000, 1_100_000, 70_000, 270_000),
            ("deepseek-r1", 550_000, 2_190_000, 140_000, 550_000),
            ("qwen-max", 2_400_000, 9_600_000, 600_000, 2_400_000),
            ("qwen-plus", 400_000, 1_200_000, 100_000, 400_000),
        ]
    });

    for &(id, inp, out, cr, cw) in catalog.iter() {
        if id == model_id {
            return Some((inp, out, cr, cw));
        }
    }

    None
}

fn proportional_cost(nominal_cost: u64, part_tokens: u64, total_tokens: u64) -> u64 {
    if nominal_cost == 0 || part_tokens == 0 || total_tokens == 0 {
        return 0;
    }
    let numerator = (nominal_cost as u128).saturating_mul(part_tokens as u128);
    let rounded = numerator.saturating_add((total_tokens as u128) / 2) / (total_tokens as u128);
    rounded.min(u64::MAX as u128) as u64
}

/// Evaluates spend according to the tenant's configured pricing contract
pub fn calculate_inference_spend(
    model_name: &str,
    input_tokens: u64,
    output_tokens: u64,
    cache_read_tokens: u64,
    cache_creation_tokens: u64,
    pricing: &TenantPricingModel,
) -> Result<FinOpsSpendResult, String> {
    let total_tokens = input_tokens
        .saturating_add(output_tokens)
        .saturating_add(cache_read_tokens)
        .saturating_add(cache_creation_tokens);

    let (in_rate, out_rate, cache_read_rate, cache_write_rate) =
        resolve_model_rates(model_name, &pricing.custom_rates).ok_or_else(|| {
            format!("No authoritative pricing rate is configured for model {model_name}")
        })?;

    // Compute nominal list cost in micro-dollars (fixed-point arithmetic with 1M divisor)
    // Formula: (tokens * rate_per_m) / 1_000_000 with proper rounding
    let list_input_cost = ((input_tokens as u128 * in_rate as u128) + 500_000) / 1_000_000;
    let list_output_cost = ((output_tokens as u128 * out_rate as u128) + 500_000) / 1_000_000;
    let list_cache_read_cost =
        ((cache_read_tokens as u128 * cache_read_rate as u128) + 500_000) / 1_000_000;
    let list_cache_write_cost =
        ((cache_creation_tokens as u128 * cache_write_rate as u128) + 500_000) / 1_000_000;

    let nominal_list_cost = list_input_cost
        .saturating_add(list_output_cost)
        .saturating_add(list_cache_read_cost)
        .saturating_add(list_cache_write_cost) as u64;

    Ok(match pricing.model_type {
        PricingModelType::FlatDiscount => {
            let discount_bps = pricing.discount_bps.min(10000) as u128;
            let discount_amount = (nominal_list_cost as u128 * discount_bps) / 10000;
            let final_cost = (nominal_list_cost as u128).saturating_sub(discount_amount) as u64;

            FinOpsSpendResult {
                model_name: model_name.to_string(),
                total_tokens,
                input_tokens,
                output_tokens,
                cache_read_tokens,
                cache_creation_tokens,
                nominal_list_cost_micro_dollars: nominal_list_cost,
                effective_cost_micro_dollars: final_cost,
                effective_discount_bps: pricing.discount_bps,
                contract_model: PricingModelType::FlatDiscount,
                ptu_capacity_applied: 0,
                ptu_overage_tokens: 0,
                tool_cost_micro_dollars: 0,
            }
        }
        PricingModelType::TieredVolume => {
            let current_volume = pricing.monthly_tokens_consumed;
            let mut active_discount_bps = pricing.discount_bps;

            for tier in &pricing.volume_tiers {
                if current_volume >= tier.min_tokens {
                    active_discount_bps = tier.discount_bps.min(10000).max(active_discount_bps);
                }
            }

            let discount_amount = (nominal_list_cost as u128 * active_discount_bps as u128) / 10000;
            let final_cost = (nominal_list_cost as u128).saturating_sub(discount_amount) as u64;

            FinOpsSpendResult {
                model_name: model_name.to_string(),
                total_tokens,
                input_tokens,
                output_tokens,
                cache_read_tokens,
                cache_creation_tokens,
                nominal_list_cost_micro_dollars: nominal_list_cost,
                effective_cost_micro_dollars: final_cost,
                effective_discount_bps: active_discount_bps,
                contract_model: PricingModelType::TieredVolume,
                ptu_capacity_applied: 0,
                ptu_overage_tokens: 0,
                tool_cost_micro_dollars: 0,
            }
        }
        PricingModelType::CommittedPtu => {
            let capacity = pricing.ptu_capacity_tokens;
            let consumed = pricing.monthly_tokens_consumed;

            if consumed < capacity {
                let remaining_ptu = capacity - consumed;
                if total_tokens <= remaining_ptu {
                    FinOpsSpendResult {
                        model_name: model_name.to_string(),
                        total_tokens,
                        input_tokens,
                        output_tokens,
                        cache_read_tokens,
                        cache_creation_tokens,
                        nominal_list_cost_micro_dollars: nominal_list_cost,
                        effective_cost_micro_dollars: 0,
                        effective_discount_bps: 10000,
                        contract_model: PricingModelType::CommittedPtu,
                        ptu_capacity_applied: total_tokens,
                        ptu_overage_tokens: 0,
                        tool_cost_micro_dollars: 0,
                    }
                } else {
                    let ptu_covered = remaining_ptu;
                    let overage = total_tokens - ptu_covered;
                    let overage_cost = proportional_cost(nominal_list_cost, overage, total_tokens);

                    FinOpsSpendResult {
                        model_name: model_name.to_string(),
                        total_tokens,
                        input_tokens,
                        output_tokens,
                        cache_read_tokens,
                        cache_creation_tokens,
                        nominal_list_cost_micro_dollars: nominal_list_cost,
                        effective_cost_micro_dollars: overage_cost,
                        effective_discount_bps: (((nominal_list_cost.saturating_sub(overage_cost))
                            as u128
                            * 10000)
                            / nominal_list_cost.max(1) as u128)
                            as u32,
                        contract_model: PricingModelType::CommittedPtu,
                        ptu_capacity_applied: ptu_covered,
                        ptu_overage_tokens: overage,
                        tool_cost_micro_dollars: 0,
                    }
                }
            } else {
                FinOpsSpendResult {
                    model_name: model_name.to_string(),
                    total_tokens,
                    input_tokens,
                    output_tokens,
                    cache_read_tokens,
                    cache_creation_tokens,
                    nominal_list_cost_micro_dollars: nominal_list_cost,
                    effective_cost_micro_dollars: nominal_list_cost,
                    effective_discount_bps: 0,
                    contract_model: PricingModelType::CommittedPtu,
                    ptu_capacity_applied: 0,
                    ptu_overage_tokens: total_tokens,
                    tool_cost_micro_dollars: 0,
                }
            }
        }
        PricingModelType::BatchDiscount => {
            // Asynchronous Batch API processing: 50% base vendor discount (5000 bps)
            // or higher if tenant negotiated a custom flat rate.
            let active_discount_bps = 5000u32.max(pricing.discount_bps.min(10000));
            let discount_amount = (nominal_list_cost as u128 * active_discount_bps as u128) / 10000;
            let final_cost = (nominal_list_cost as u128).saturating_sub(discount_amount) as u64;

            FinOpsSpendResult {
                model_name: model_name.to_string(),
                total_tokens,
                input_tokens,
                output_tokens,
                cache_read_tokens,
                cache_creation_tokens,
                nominal_list_cost_micro_dollars: nominal_list_cost,
                effective_cost_micro_dollars: final_cost,
                effective_discount_bps: active_discount_bps,
                contract_model: PricingModelType::BatchDiscount,
                ptu_capacity_applied: 0,
                ptu_overage_tokens: 0,
                tool_cost_micro_dollars: 0,
            }
        }
        PricingModelType::PerUnitRequest => {
            // Fixed invocation / tolling fee added to token pass-through
            let fixed_fee = pricing.per_call_fee_micro_dollars;
            let discount_bps = pricing.discount_bps.min(10000) as u128;
            let discount_amount = (nominal_list_cost as u128 * discount_bps) / 10000;
            let compute_cost = (nominal_list_cost as u128).saturating_sub(discount_amount) as u64;
            let final_cost = compute_cost.saturating_add(fixed_fee);

            FinOpsSpendResult {
                model_name: model_name.to_string(),
                total_tokens,
                input_tokens,
                output_tokens,
                cache_read_tokens,
                cache_creation_tokens,
                nominal_list_cost_micro_dollars: nominal_list_cost.saturating_add(fixed_fee),
                effective_cost_micro_dollars: final_cost,
                effective_discount_bps: pricing.discount_bps,
                contract_model: PricingModelType::PerUnitRequest,
                ptu_capacity_applied: 0,
                ptu_overage_tokens: 0,
                tool_cost_micro_dollars: fixed_fee,
            }
        }
        PricingModelType::HybridCommitVolume => {
            // Reserved PTU capacity with graduated volume tiers on overage
            let capacity = pricing.ptu_capacity_tokens;
            let consumed = pricing.monthly_tokens_consumed;

            if consumed < capacity {
                let remaining_ptu = capacity - consumed;
                if total_tokens <= remaining_ptu {
                    FinOpsSpendResult {
                        model_name: model_name.to_string(),
                        total_tokens,
                        input_tokens,
                        output_tokens,
                        cache_read_tokens,
                        cache_creation_tokens,
                        nominal_list_cost_micro_dollars: nominal_list_cost,
                        effective_cost_micro_dollars: 0,
                        effective_discount_bps: 10000,
                        contract_model: PricingModelType::HybridCommitVolume,
                        ptu_capacity_applied: total_tokens,
                        ptu_overage_tokens: 0,
                        tool_cost_micro_dollars: 0,
                    }
                } else {
                    let ptu_covered = remaining_ptu;
                    let overage = total_tokens - ptu_covered;
                    let overage_nominal =
                        proportional_cost(nominal_list_cost, overage, total_tokens);

                    let mut overage_discount_bps = pricing.discount_bps;
                    for tier in &pricing.volume_tiers {
                        if consumed + total_tokens >= tier.min_tokens {
                            overage_discount_bps =
                                tier.discount_bps.min(10000).max(overage_discount_bps);
                        }
                    }
                    let discount_amount =
                        (overage_nominal as u128 * overage_discount_bps as u128) / 10000;
                    let overage_cost =
                        (overage_nominal as u128).saturating_sub(discount_amount) as u64;

                    FinOpsSpendResult {
                        model_name: model_name.to_string(),
                        total_tokens,
                        input_tokens,
                        output_tokens,
                        cache_read_tokens,
                        cache_creation_tokens,
                        nominal_list_cost_micro_dollars: nominal_list_cost,
                        effective_cost_micro_dollars: overage_cost,
                        effective_discount_bps: (((nominal_list_cost.saturating_sub(overage_cost))
                            as u128
                            * 10000)
                            / nominal_list_cost.max(1) as u128)
                            as u32,
                        contract_model: PricingModelType::HybridCommitVolume,
                        ptu_capacity_applied: ptu_covered,
                        ptu_overage_tokens: overage,
                        tool_cost_micro_dollars: 0,
                    }
                }
            } else {
                let mut overage_discount_bps = pricing.discount_bps;
                for tier in &pricing.volume_tiers {
                    if consumed >= tier.min_tokens {
                        overage_discount_bps =
                            tier.discount_bps.min(10000).max(overage_discount_bps);
                    }
                }
                let discount_amount =
                    (nominal_list_cost as u128 * overage_discount_bps as u128) / 10000;
                let final_cost = (nominal_list_cost as u128).saturating_sub(discount_amount) as u64;

                FinOpsSpendResult {
                    model_name: model_name.to_string(),
                    total_tokens,
                    input_tokens,
                    output_tokens,
                    cache_read_tokens,
                    cache_creation_tokens,
                    nominal_list_cost_micro_dollars: nominal_list_cost,
                    effective_cost_micro_dollars: final_cost,
                    effective_discount_bps: overage_discount_bps,
                    contract_model: PricingModelType::HybridCommitVolume,
                    ptu_capacity_applied: 0,
                    ptu_overage_tokens: total_tokens,
                    tool_cost_micro_dollars: 0,
                }
            }
        }
    })
}

/// Payload exchanged between distributed gateway instances to sync token volumes (ADR 0010 multi-region)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FinopsSyncPayload {
    #[serde(rename = "nodeId")]
    pub node_id: String,
    #[serde(rename = "orgId")]
    pub org_id: String,
    #[serde(rename = "deltaTokens")]
    pub delta_tokens: u64,
    #[serde(rename = "syncTimestamp")]
    pub sync_timestamp: i64,
    #[serde(rename = "sequenceNumber")]
    pub sequence_number: u64,
}

/// Response acknowledging sync and returning reconciled monthly total
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FinopsSyncResponse {
    pub synced: bool,
    #[serde(rename = "orgId")]
    pub org_id: String,
    #[serde(rename = "reconciledMonthlyTokens")]
    pub reconciled_monthly_tokens: u64,
    #[serde(rename = "activeDiscountBps")]
    pub active_discount_bps: u32,
    #[serde(rename = "currentTierIndex")]
    pub current_tier_index: usize,
}

/// Computes the active volume tier and effective discount percentage
pub fn compute_active_tier_and_discount(pricing: &TenantPricingModel) -> (usize, u32) {
    let mut effective_discount = pricing.discount_bps;
    let mut current_tier_idx = 0;

    for (idx, tier) in pricing.volume_tiers.iter().enumerate() {
        if pricing.monthly_tokens_consumed >= tier.min_tokens
            && tier.discount_bps > effective_discount
        {
            effective_discount = tier.discount_bps;
            current_tier_idx = idx + 1;
        }
    }

    (current_tier_idx, effective_discount)
}

/// Pre-Flight Streaming Token Reserve Hold (ADR 0010)
///
/// Guards against concurrency race conditions during multi-second streaming completions.
/// Holds an estimated token quota in memory while the streaming connection is active,
/// then reconciles the exact consumed tokens and releases the reservation.
///
/// Uses `std::sync::RwLock` (not `Mutex`) so concurrent agent reservation *reads*
/// do not block each other — only writes (acquire/release) take an exclusive lock.
/// Critical sections are pure HashMap ops with zero await points, making `std::sync`
/// primitives correct and avoiding Tokio worker-thread starvation.
#[derive(Debug, Clone, Default)]
pub struct StreamingReserveHold {
    active_holds: std::sync::Arc<std::sync::RwLock<HashMap<String, u64>>>,
}

impl StreamingReserveHold {
    pub fn new() -> Self {
        Self {
            active_holds: std::sync::Arc::new(std::sync::RwLock::new(HashMap::new())),
        }
    }

    /// Acquires a temporary reservation for an agent before launching a streaming request.
    /// Returns the total active in-flight tokens held for this agent (including the new reservation).
    pub fn acquire(&self, agent_address: &str, estimated_tokens: u64) -> u64 {
        let mut holds = self.active_holds.write().unwrap_or_else(|p| p.into_inner());
        let current = holds.entry(agent_address.to_lowercase()).or_insert(0);
        *current = current.saturating_add(estimated_tokens);
        *current
    }

    /// Releases the temporary reservation once the stream terminates or errors out.
    /// Returns the remaining in-flight reservation for the agent.
    pub fn release(&self, agent_address: &str, estimated_tokens: u64) -> u64 {
        let mut holds = self.active_holds.write().unwrap_or_else(|p| p.into_inner());
        let key = agent_address.to_lowercase();
        if let Some(current) = holds.get_mut(&key) {
            *current = current.saturating_sub(estimated_tokens);
            let remaining = *current;
            if remaining == 0 {
                holds.remove(&key);
            }
            remaining
        } else {
            0
        }
    }

    /// Returns the currently active in-flight token reservation for an agent.
    /// Uses a read lock — concurrent callers do not block each other.
    pub fn active_reservation(&self, agent_address: &str) -> u64 {
        let holds = self.active_holds.read().unwrap_or_else(|p| p.into_inner());
        holds
            .get(&agent_address.to_lowercase())
            .copied()
            .unwrap_or(0)
    }

    /// Acquires an RAII guard that automatically releases the reservation on drop.
    pub fn acquire_guard(
        &self,
        agent_address: &str,
        estimated_tokens: u64,
    ) -> StreamingReserveGuard {
        self.acquire(agent_address, estimated_tokens);
        StreamingReserveGuard {
            holds: self.active_holds.clone(),
            agent: agent_address.to_lowercase(),
            tokens: estimated_tokens,
        }
    }
}

/// RAII Guard ensuring reservation is always freed upon request termination or error.
/// Holds an Arc to the RwLock map — not the lock guard itself — so it is safely `Send`
/// and can be held across `.await` points in async streaming handlers.
pub struct StreamingReserveGuard {
    holds: std::sync::Arc<std::sync::RwLock<HashMap<String, u64>>>,
    agent: String,
    tokens: u64,
}

impl Drop for StreamingReserveGuard {
    fn drop(&mut self) {
        // Drop acquires a write lock for a pure hashmap mutation — no await points,
        // no I/O, no risk of blocking the Tokio runtime for a meaningful duration.
        let mut map = self.holds.write().unwrap_or_else(|p| p.into_inner());
        if let Some(current) = map.get_mut(&self.agent) {
            *current = current.saturating_sub(self.tokens);
            if *current == 0 {
                map.remove(&self.agent);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::VolumeTier;

    #[test]
    fn test_flat_discount_calculation() {
        let pricing = TenantPricingModel {
            org_id: "org_1".to_string(),
            model_type: PricingModelType::FlatDiscount,
            discount_bps: 2000, // 20% discount
            volume_tiers: vec![],
            ptu_capacity_tokens: 0,
            custom_rates: HashMap::new(),
            monthly_tokens_consumed: 0,
            updated_at: "2026-09-17T00:00:00Z".to_string(),
            ..Default::default()
        };

        // claude-3-7-sonnet: 1,000,000 input tokens = $3.00 (3,000,000 micro-dollars)
        let result =
            calculate_inference_spend("claude-3-7-sonnet", 1_000_000, 0, 0, 0, &pricing).unwrap();
        assert_eq!(result.nominal_list_cost_micro_dollars, 3_000_000);
        // 20% off $3.00 = $2.40 (2,400,000 micro-dollars)
        assert_eq!(result.effective_cost_micro_dollars, 2_400_000);
        assert_eq!(result.effective_discount_bps, 2000);
    }

    #[test]
    fn test_tiered_volume_ladder() {
        let pricing = TenantPricingModel {
            org_id: "org_1".to_string(),
            model_type: PricingModelType::TieredVolume,
            discount_bps: 500, // 5% base
            volume_tiers: vec![
                VolumeTier {
                    min_tokens: 10_000_000,
                    discount_bps: 1500, // 15% at 10M
                },
                VolumeTier {
                    min_tokens: 50_000_000,
                    discount_bps: 3000, // 30% at 50M
                },
            ],
            ptu_capacity_tokens: 0,
            custom_rates: HashMap::new(),
            monthly_tokens_consumed: 15_000_000, // in Tier 2
            updated_at: "2026-09-17T00:00:00Z".to_string(),
            ..Default::default()
        };

        // gpt-4o: 100,000 input tokens = $0.25 (250,000 micro-dollars)
        let result = calculate_inference_spend("gpt-4o", 100_000, 0, 0, 0, &pricing).unwrap();
        assert_eq!(result.nominal_list_cost_micro_dollars, 250_000);
        // 15% off 250,000 = 212,500
        assert_eq!(result.effective_cost_micro_dollars, 212_500);
        assert_eq!(result.effective_discount_bps, 1500);
    }

    #[test]
    fn test_committed_ptu_absorption() {
        let pricing = TenantPricingModel {
            org_id: "org_1".to_string(),
            model_type: PricingModelType::CommittedPtu,
            discount_bps: 0,
            volume_tiers: vec![],
            ptu_capacity_tokens: 1_000_000,
            custom_rates: HashMap::new(),
            monthly_tokens_consumed: 500_000,
            updated_at: "2026-09-17T00:00:00Z".to_string(),
            ..Default::default()
        };

        // Within capacity (200k tokens < 500k remaining) -> marginal $0
        let result =
            calculate_inference_spend("claude-3-7-sonnet", 100_000, 100_000, 0, 0, &pricing)
                .unwrap();
        assert_eq!(result.effective_cost_micro_dollars, 0);
        assert_eq!(result.ptu_capacity_applied, 200_000);
        assert_eq!(result.ptu_overage_tokens, 0);
    }

    #[test]
    fn test_streaming_reserve_hold() {
        let hold = StreamingReserveHold::new();
        let agent = "0x1111111111111111111111111111111111111111";

        // Initial hold: 0
        assert_eq!(hold.active_reservation(agent), 0);

        // Acquire 4096 tokens
        let total = hold.acquire(agent, 4096);
        assert_eq!(total, 4096);
        assert_eq!(hold.active_reservation(agent), 4096);

        // Acquire concurrent 2048 tokens
        let total2 = hold.acquire(agent, 2048);
        assert_eq!(total2, 6144);
        assert_eq!(hold.active_reservation(agent), 6144);

        // Release first 4096 tokens
        let remaining = hold.release(agent, 4096);
        assert_eq!(remaining, 2048);
        assert_eq!(hold.active_reservation(agent), 2048);

        // Release remaining 2048 tokens
        let remaining2 = hold.release(agent, 2048);
        assert_eq!(remaining2, 0);
        assert_eq!(hold.active_reservation(agent), 0);
    }
}
