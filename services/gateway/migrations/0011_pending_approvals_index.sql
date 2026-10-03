-- Serves GET /api/v1/wallet-transfers/pending: org-scoped, newest first, only rows awaiting approval.
CREATE INDEX IF NOT EXISTS idx_wallet_transfers_org_pending_approval
    ON wallet_transfers (org_id, created_at DESC)
    WHERE status = 'pending_approval';
