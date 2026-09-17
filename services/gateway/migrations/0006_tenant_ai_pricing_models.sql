-- Migration 0006: Tenant AI Provider Pricing Models & FinOps Dual-Denomination Engine
-- Implements ADR 0010: Flat Custom Discounts, Tiered Volume Ladders, Committed-Use PTUs,
-- and Custom Model Rate Cards.

CREATE TABLE IF NOT EXISTS tenant_ai_pricing_models (
    org_id TEXT PRIMARY KEY REFERENCES organizations(org_id),
    model_type TEXT NOT NULL DEFAULT 'flat_discount' CHECK (model_type IN ('flat_discount', 'tiered_volume', 'committed_ptu')),
    discount_bps INT NOT NULL DEFAULT 0 CHECK (discount_bps >= 0 AND discount_bps <= 10000),
    volume_tiers JSONB NOT NULL DEFAULT '[]'::jsonb,
    ptu_capacity_tokens BIGINT NOT NULL DEFAULT 0 CHECK (ptu_capacity_tokens >= 0),
    custom_rates JSONB NOT NULL DEFAULT '{}'::jsonb,
    monthly_tokens_consumed BIGINT NOT NULL DEFAULT 0 CHECK (monthly_tokens_consumed >= 0),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS tenant_ai_pricing_models_org_idx ON tenant_ai_pricing_models(org_id);
