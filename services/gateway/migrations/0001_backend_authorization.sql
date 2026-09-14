CREATE TABLE organizations (
    org_id TEXT PRIMARY KEY,
    enterprise_address TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE operators (
    org_id TEXT NOT NULL REFERENCES organizations(org_id),
    subject TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('super_admin', 'sec_ops', 'treasury', 'fleet_devops', 'agent_developer', 'auditor')),
    mfa_authenticated BOOLEAN NOT NULL DEFAULT FALSE,
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (org_id, subject)
);

CREATE UNIQUE INDEX operators_one_tenant_per_subject_idx ON operators(subject);

CREATE TABLE role_change_operations (
    id UUID PRIMARY KEY DEFAULT uuidv7() CHECK (uuid_extract_version(id) = 7),
    org_id TEXT NOT NULL REFERENCES organizations(org_id),
    subject TEXT NOT NULL,
    requested_role TEXT NOT NULL CHECK (requested_role IN ('super_admin', 'sec_ops', 'treasury', 'fleet_devops', 'agent_developer', 'auditor')),
    status TEXT NOT NULL CHECK (status IN ('pending', 'succeeded', 'failed')),
    failure_reason TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at TIMESTAMPTZ
);

CREATE INDEX role_change_operations_pending_idx ON role_change_operations(status, created_at)
WHERE status = 'pending';

CREATE TABLE api_keys (
    id UUID PRIMARY KEY DEFAULT uuidv7() CHECK (uuid_extract_version(id) = 7),
    org_id TEXT NOT NULL REFERENCES organizations(org_id),
    subject TEXT NOT NULL,
    agent_address TEXT NOT NULL,
    key_prefix TEXT NOT NULL UNIQUE,
    key_hash BYTEA NOT NULL UNIQUE,
    capabilities JSONB NOT NULL DEFAULT '[]'::jsonb,
    expires_at TIMESTAMPTZ,
    revoked_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX api_keys_org_agent_idx ON api_keys(org_id, agent_address);

CREATE TABLE authorization_policies (
    id UUID NOT NULL DEFAULT uuidv7() CHECK (uuid_extract_version(id) = 7),
    org_id TEXT NOT NULL REFERENCES organizations(org_id),
    version BIGINT NOT NULL CHECK (version > 0),
    effect TEXT NOT NULL CHECK (effect IN ('allow', 'deny')),
    principals JSONB NOT NULL DEFAULT '[]'::jsonb,
    actions JSONB NOT NULL DEFAULT '[]'::jsonb,
    resources JSONB NOT NULL DEFAULT '[]'::jsonb,
    conditions JSONB NOT NULL DEFAULT '{}'::jsonb,
    active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (org_id, id, version)
);

CREATE INDEX authorization_policies_active_idx ON authorization_policies(org_id, active, version);

CREATE TABLE tenant_policies (
    org_id TEXT PRIMARY KEY REFERENCES organizations(org_id),
    attributes JSONB NOT NULL DEFAULT '{}'::jsonb,
    active BOOLEAN NOT NULL DEFAULT TRUE,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE agents (
    org_id TEXT NOT NULL REFERENCES organizations(org_id),
    agent_address TEXT NOT NULL,
    admin_address TEXT NOT NULL,
    environment TEXT NOT NULL CHECK (environment IN ('production', 'staging', 'sandbox')),
    risk_tier TEXT NOT NULL CHECK (risk_tier IN ('tier1_critical', 'tier2_standard', 'tier3_test')),
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (org_id, agent_address)
);

CREATE TABLE approval_tickets (
    id UUID PRIMARY KEY DEFAULT uuidv7() CHECK (uuid_extract_version(id) = 7),
    org_id TEXT NOT NULL REFERENCES organizations(org_id),
    resource TEXT NOT NULL,
    required_signatures SMALLINT NOT NULL CHECK (required_signatures > 0),
    signatures JSONB NOT NULL DEFAULT '[]'::jsonb,
    status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'approved', 'rejected', 'expired')),
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE idempotency_keys (
    org_id TEXT NOT NULL REFERENCES organizations(org_id),
    key TEXT NOT NULL,
    request_hash BYTEA NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('pending', 'confirmed', 'failed')),
    response JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (org_id, key)
);

CREATE TABLE chain_events (
    chain_id BIGINT NOT NULL,
    block_number BIGINT NOT NULL,
    block_hash TEXT NOT NULL,
    transaction_hash TEXT NOT NULL,
    log_index BIGINT NOT NULL,
    event_name TEXT NOT NULL,
    agent_address TEXT,
    org_id TEXT REFERENCES organizations(org_id),
    payload JSONB NOT NULL,
    finalized BOOLEAN NOT NULL DEFAULT FALSE,
    observed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (chain_id, transaction_hash, log_index)
);

CREATE INDEX chain_events_tenant_idx ON chain_events(org_id, block_number DESC);
CREATE INDEX chain_events_agent_idx ON chain_events(agent_address, block_number DESC);

CREATE TABLE event_checkpoints (
    chain_id BIGINT PRIMARY KEY,
    next_block BIGINT NOT NULL,
    block_hash TEXT NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
