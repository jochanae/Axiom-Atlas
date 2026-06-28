-- Obsidian Ledger: personal asset + transaction tracking
-- Run this in the Supabase SQL editor

CREATE TABLE IF NOT EXISTS ledger_assets (
  id          bigserial PRIMARY KEY,
  user_id     integer NOT NULL,
  name        text NOT NULL,
  category    text NOT NULL DEFAULT 'Other',
  value_cents bigint NOT NULL DEFAULT 0,
  notes       text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS ledger_transactions (
  id           bigserial PRIMARY KEY,
  user_id      integer NOT NULL,
  asset_id     integer,
  action       text NOT NULL CHECK (action IN ('acquired', 'appreciated', 'depreciated', 'divested')),
  amount_cents bigint NOT NULL DEFAULT 0,
  note         text,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ledger_assets_user_id_idx        ON ledger_assets(user_id);
CREATE INDEX IF NOT EXISTS ledger_transactions_user_id_idx  ON ledger_transactions(user_id);
CREATE INDEX IF NOT EXISTS ledger_transactions_asset_id_idx ON ledger_transactions(asset_id);
