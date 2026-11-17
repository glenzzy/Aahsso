-- Mobile money through Fapshi (replaces the earlier provider).
ALTER TABLE payments ADD COLUMN IF NOT EXISTS checkout_url text;               -- Fapshi payment page, while it can still be paid
ALTER TABLE payments ADD COLUMN IF NOT EXISTS provider_checked_at timestamptz; -- last status check (Fapshi allows 6 a minute)
-- nothing is left waiting on the old provider
UPDATE payments SET status = 'failed', decided_at = now(), failure = 'Cancelled: mobile money now goes through Fapshi. Pay again.'
  WHERE provider = 'pawapay' AND status = 'processing';
UPDATE payments SET network = CASE network WHEN 'MTN_MOMO_CMR' THEN 'mtn' WHEN 'ORANGE_CMR' THEN 'orange' ELSE network END,
  phone = CASE WHEN phone ~ '^2376[0-9]{8}$' THEN substr(phone, 4) ELSE phone END
  WHERE network IN ('MTN_MOMO_CMR', 'ORANGE_CMR') OR phone ~ '^2376[0-9]{8}$';
DELETE FROM schema_migrations WHERE name = '018_pawapay.sql';
