-- Migration 0009: Add first-class agent label to agents table
ALTER TABLE agents ADD COLUMN IF NOT EXISTS label TEXT NOT NULL DEFAULT '';
UPDATE agents a SET label = sw.label FROM signing_wallets sw WHERE sw.id = a.wallet_id AND a.label = '';
