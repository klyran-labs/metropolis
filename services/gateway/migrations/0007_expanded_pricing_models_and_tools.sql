-- Migration 0007: Expanded Enterprise AI Pricing Models, Non-Token Tool Services & Dual-Denomination Caps
-- Implements ADR 0010: Batch Discount (50%), Per-Unit Toll Fee + Pass-Through, Hybrid PTU Commit + Volume Ladders,
-- Tool Service Catalog (Serper, Firecrawl, Tavily, E2B, Custom Webhooks), and Token Cap Quotas.

ALTER TABLE tenant_ai_pricing_models
    DROP CONSTRAINT IF EXISTS tenant_ai_pricing_models_model_type_check;

ALTER TABLE tenant_ai_pricing_models
    ADD CONSTRAINT tenant_ai_pricing_models_model_type_check
    CHECK (model_type IN ('flat_discount', 'tiered_volume', 'committed_ptu', 'batch_discount', 'per_unit_request', 'hybrid_commit_volume'));

ALTER TABLE tenant_ai_pricing_models
    ADD COLUMN IF NOT EXISTS token_cap_tokens BIGINT NOT NULL DEFAULT 0 CHECK (token_cap_tokens >= 0),
    ADD COLUMN IF NOT EXISTS per_call_fee_micro_dollars BIGINT NOT NULL DEFAULT 0 CHECK (per_call_fee_micro_dollars >= 0),
    ADD COLUMN IF NOT EXISTS tool_custom_rates JSONB NOT NULL DEFAULT '{}'::jsonb;
