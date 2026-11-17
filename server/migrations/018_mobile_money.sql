-- Mobile money: automatic payments that settle themselves (safe to run again: every statement is idempotent).
--   processing = sent to the payment provider, waiting for the payer; failed = declined / expired / never received.
ALTER TABLE payments DROP CONSTRAINT IF EXISTS payments_status_check;
ALTER TABLE payments ADD CONSTRAINT payments_status_check CHECK (status IN ('pending', 'processing', 'confirmed', 'rejected', 'failed'));
ALTER TABLE payments ADD COLUMN IF NOT EXISTS provider_ref text;   -- the provider's transaction id
ALTER TABLE payments ADD COLUMN IF NOT EXISTS provider_txn text;   -- the network's own transaction id, once paid
ALTER TABLE payments ADD COLUMN IF NOT EXISTS phone text;          -- payer number (6XXXXXXXX), when the payer typed it in Aahsso
ALTER TABLE payments ADD COLUMN IF NOT EXISTS network text;        -- mtn | orange
ALTER TABLE payments ADD COLUMN IF NOT EXISTS failure text;        -- why it failed, in plain words
CREATE UNIQUE INDEX IF NOT EXISTS payments_provider_ref_idx ON payments(provider, provider_ref) WHERE provider_ref IS NOT NULL;
CREATE INDEX IF NOT EXISTS payments_processing_idx ON payments(created_at) WHERE status = 'processing';
