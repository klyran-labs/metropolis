-- Durable multi-region FinOps deduplication ledger.
-- A node may retry a sequence, but the same organization/node/sequence is applied once.
CREATE TABLE IF NOT EXISTS finops_sync_ledger (
    org_id TEXT NOT NULL REFERENCES organizations(org_id),
    node_id TEXT NOT NULL,
    sequence_number BIGINT NOT NULL CHECK (sequence_number > 0),
    delta_tokens BIGINT NOT NULL CHECK (delta_tokens >= 0),
    received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (org_id, node_id, sequence_number)
);

CREATE INDEX IF NOT EXISTS finops_sync_ledger_org_node_idx
    ON finops_sync_ledger(org_id, node_id, sequence_number DESC);
