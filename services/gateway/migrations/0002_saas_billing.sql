CREATE TABLE platform_operators (
    subject TEXT PRIMARY KEY,
    role TEXT NOT NULL CHECK (role IN (
        'platform_super_admin',
        'platform_operations',
        'platform_security',
        'platform_billing',
        'platform_support',
        'platform_auditor',
        'platform_viewer'
    )),
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE agent_policies (
    org_id TEXT NOT NULL REFERENCES organizations(org_id),
    agent_address TEXT NOT NULL,
    version BIGINT NOT NULL CHECK (version > 0),
    policy JSONB NOT NULL,
    onchain_tx_hash TEXT,
    effective_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (org_id, agent_address, version),
    FOREIGN KEY (org_id, agent_address) REFERENCES agents(org_id, agent_address)
);

CREATE INDEX agent_policies_latest_idx
    ON agent_policies(org_id, agent_address, version DESC);

CREATE TABLE plans (
    id UUID PRIMARY KEY DEFAULT uuidv7() CHECK (uuid_extract_version(id) = 7),
    code TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE plan_prices (
    id UUID PRIMARY KEY DEFAULT uuidv7() CHECK (uuid_extract_version(id) = 7),
    plan_id UUID NOT NULL REFERENCES plans(id),
    chain_id BIGINT NOT NULL CHECK (chain_id IN (10143, 143)),
    token_address TEXT NOT NULL,
    amount_base_units NUMERIC(78, 0) NOT NULL CHECK (amount_base_units > 0),
    interval TEXT NOT NULL CHECK (interval IN ('monthly', 'annual')),
    active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (plan_id, chain_id, token_address, interval)
);

CREATE TABLE subscriptions (
    id UUID PRIMARY KEY DEFAULT uuidv7() CHECK (uuid_extract_version(id) = 7),
    org_id TEXT NOT NULL UNIQUE REFERENCES organizations(org_id),
    plan_price_id UUID NOT NULL REFERENCES plan_prices(id),
    status TEXT NOT NULL CHECK (status IN ('pending', 'active', 'past_due', 'cancelled', 'expired')),
    current_period_start TIMESTAMPTZ NOT NULL,
    current_period_end TIMESTAMPTZ NOT NULL,
    cancel_at_period_end BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE billing_payments (
    id UUID PRIMARY KEY DEFAULT uuidv7() CHECK (uuid_extract_version(id) = 7),
    subscription_id UUID NOT NULL REFERENCES subscriptions(id),
    idempotency_key TEXT NOT NULL,
    chain_id BIGINT NOT NULL CHECK (chain_id IN (10143, 143)),
    token_address TEXT NOT NULL,
    merchant_address TEXT NOT NULL,
    amount_base_units NUMERIC(78, 0) NOT NULL CHECK (amount_base_units > 0),
    spend_request JSONB NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('created', 'submitted', 'confirmed', 'failed')),
    transaction_hash TEXT UNIQUE,
    block_number BIGINT,
    reason_code SMALLINT CHECK (reason_code BETWEEN 0 AND 9),
    failure_reason TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (subscription_id, idempotency_key)
);

CREATE INDEX billing_payments_status_idx ON billing_payments(status, updated_at);
CREATE INDEX billing_payments_tenant_idx ON billing_payments(subscription_id, created_at DESC);

CREATE TABLE billing_ledger_entries (
    id UUID PRIMARY KEY DEFAULT uuidv7() CHECK (uuid_extract_version(id) = 7),
    org_id TEXT NOT NULL REFERENCES organizations(org_id),
    billing_payment_id UUID NOT NULL UNIQUE REFERENCES billing_payments(id),
    entry_type TEXT NOT NULL CHECK (entry_type IN ('subscription_charge', 'refund')),
    amount_base_units NUMERIC(78, 0) NOT NULL CHECK (amount_base_units > 0),
    chain_id BIGINT NOT NULL,
    transaction_hash TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
