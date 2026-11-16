-- Mobile money through pawaPay: automatic payments that settle themselves.
--   processing = sent to pawaPay, waiting for the payer's PIN; failed = declined / timed out / never received.
ALTER TABLE payments DROP CONSTRAINT IF EXISTS payments_status_check;
ALTER TABLE payments ADD CONSTRAINT payments_status_check CHECK (status IN ('pending', 'processing', 'confirmed', 'rejected', 'failed'));
ALTER TABLE payments ADD COLUMN IF NOT EXISTS provider_ref text;   -- our pawaPay depositId (idempotency key)
ALTER TABLE payments ADD COLUMN IF NOT EXISTS provider_txn text;   -- the network's own transaction id, once paid
ALTER TABLE payments ADD COLUMN IF NOT EXISTS phone text;          -- payer number, 2376XXXXXXXX
ALTER TABLE payments ADD COLUMN IF NOT EXISTS network text;        -- MTN_MOMO_CMR | ORANGE_CMR
ALTER TABLE payments ADD COLUMN IF NOT EXISTS failure text;        -- why it failed, in plain words
CREATE UNIQUE INDEX IF NOT EXISTS payments_provider_ref_idx ON payments(provider, provider_ref) WHERE provider_ref IS NOT NULL;
CREATE INDEX IF NOT EXISTS payments_processing_idx ON payments(created_at) WHERE status = 'processing';
