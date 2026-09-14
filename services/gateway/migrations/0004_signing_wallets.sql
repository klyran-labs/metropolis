CREATE TABLE signing_wallets (
    id UUID PRIMARY KEY DEFAULT uuidv7() CHECK (uuid_extract_version(id) = 7),
    org_id TEXT NOT NULL REFERENCES organizations(org_id),
    wallet_id TEXT NOT NULL UNIQUE,
    wallet_address TEXT NOT NULL UNIQUE,
    label TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX signing_wallets_tenant_idx ON signing_wallets(org_id, created_at DESC);
