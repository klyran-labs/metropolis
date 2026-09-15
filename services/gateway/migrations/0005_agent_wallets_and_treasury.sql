-- Distinguishes an agent's own signing wallet from an organization treasury wallet that
-- happens to also be OpenSigner-provisioned; both live in signing_wallets (one OpenSigner
-- vault backs both), disambiguated here.
ALTER TABLE signing_wallets ADD COLUMN kind TEXT NOT NULL DEFAULT 'agent' CHECK (kind IN ('agent', 'treasury'));

-- An agent registered with an OpenSigner-generated wallet links here; agents registered against
-- a caller-supplied external address leave this NULL.
ALTER TABLE agents ADD COLUMN wallet_id UUID REFERENCES signing_wallets(id);
ALTER TABLE agents ADD COLUMN wallet_source TEXT NOT NULL DEFAULT 'external' CHECK (wallet_source IN ('external', 'sovereign'));

-- Organization treasury wallets. organizations.enterprise_address is left untouched (existing
-- onboarding-proof semantics) and is treated as the tenant's first treasury wallet going
-- forward, not the only one.
CREATE TABLE organization_wallets (
    id UUID PRIMARY KEY DEFAULT uuidv7() CHECK (uuid_extract_version(id) = 7),
    org_id TEXT NOT NULL REFERENCES organizations(org_id),
    address TEXT NOT NULL,
    label TEXT NOT NULL DEFAULT '',
    kind TEXT NOT NULL CHECK (kind IN ('external', 'sovereign')),
    wallet_id UUID REFERENCES signing_wallets(id),
    approval_threshold SMALLINT NOT NULL DEFAULT 1 CHECK (approval_threshold > 0),
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended')),
    created_by_subject TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (org_id, address)
);

CREATE INDEX organization_wallets_tenant_idx ON organization_wallets(org_id, created_at DESC);

-- Fine-grained access: holding the treasury role is necessary but not sufficient to act on a
-- specific wallet. super_admin bypasses this, same as every other capability check.
CREATE TABLE organization_wallet_access (
    wallet_id UUID NOT NULL REFERENCES organization_wallets(id),
    subject TEXT NOT NULL,
    granted_by_subject TEXT NOT NULL,
    granted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (wallet_id, subject)
);

-- Real, chain-verified load/unload history. A row moves to 'confirmed' only after the gateway
-- independently verifies the submitted transaction's receipt, mirroring billing_payments.
CREATE TABLE wallet_transfers (
    id UUID PRIMARY KEY DEFAULT uuidv7() CHECK (uuid_extract_version(id) = 7),
    org_id TEXT NOT NULL REFERENCES organizations(org_id),
    direction TEXT NOT NULL CHECK (direction IN ('load', 'unload')),
    organization_wallet_id UUID NOT NULL REFERENCES organization_wallets(id),
    agent_address TEXT NOT NULL,
    token_address TEXT NOT NULL,
    amount_base_units NUMERIC(78, 0) NOT NULL CHECK (amount_base_units > 0),
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'pending_approval', 'confirmed', 'failed')),
    transaction_hash TEXT,
    failure_reason TEXT,
    initiated_by_subject TEXT NOT NULL,
    approval_ticket_id UUID REFERENCES approval_tickets(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    confirmed_at TIMESTAMPTZ
);

CREATE INDEX wallet_transfers_tenant_idx ON wallet_transfers(org_id, created_at DESC);
CREATE INDEX wallet_transfers_agent_idx ON wallet_transfers(agent_address, created_at DESC);
