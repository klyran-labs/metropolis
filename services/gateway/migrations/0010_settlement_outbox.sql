-- Migration: 0010_settlement_outbox.sql
-- Description: Durable Transactional Outbox and Clearing Pipeline for AgentGuard on Monad Parallel EVM

CREATE TABLE IF NOT EXISTS settlement_outbox (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    task_id UUID NOT NULL UNIQUE,
    agent_address VARCHAR(42) NOT NULL,
    merchant_address VARCHAR(42) NOT NULL,
    token_address VARCHAR(42) NOT NULL,
    amount VARCHAR(78) NOT NULL,
    nonce VARCHAR(78) NOT NULL,
    signature BYTEA NOT NULL,
    category BYTEA NOT NULL,
    timestamp_val VARCHAR(78) NOT NULL,
    deadline VARCHAR(78) NOT NULL,
    status VARCHAR(32) NOT NULL DEFAULT 'pending',
    tx_hash VARCHAR(66),
    attempt_count INT NOT NULL DEFAULT 0,
    max_attempts INT NOT NULL DEFAULT 5,
    next_retry_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_error TEXT,
    trace_id VARCHAR(64),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_settlement_outbox_queue 
    ON settlement_outbox (status, next_retry_at) 
    WHERE status IN ('pending', 'retrying', 'failed');

CREATE INDEX IF NOT EXISTS idx_settlement_outbox_agent 
    ON settlement_outbox (agent_address, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_settlement_outbox_tx_hash 
    ON settlement_outbox (tx_hash) 
    WHERE tx_hash IS NOT NULL;
