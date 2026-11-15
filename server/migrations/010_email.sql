-- Emails (Resend): where to write to each person, password reset links, and a log of every email.
-- A login can be a phone number, so people may also have a separate email address.
ALTER TABLE users ADD COLUMN IF NOT EXISTS email text;

-- "Forgot password" links: only a hash of the token is stored; each link works once, for a limited time.
CREATE TABLE IF NOT EXISTS password_resets (
  token_hash  text PRIMARY KEY,
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at  timestamptz NOT NULL,
  used_at     timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS password_resets_user_idx ON password_resets(user_id);

-- Every email we try to send. `dedupe` stops the same automatic email going out twice (e.g. a daily job run twice).
CREATE TABLE IF NOT EXISTS email_log (
  id           bigserial PRIMARY KEY,
  tenant_id    uuid REFERENCES tenants(id) ON DELETE CASCADE,
  kind         text NOT NULL,
  dedupe       text,
  to_addr      text NOT NULL,
  subject      text,
  status       text NOT NULL,            -- sent | skipped (no API key) | failed
  provider_id  text,
  error        text,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS email_log_dedupe_idx ON email_log(dedupe) WHERE dedupe IS NOT NULL AND status <> 'failed';
CREATE INDEX IF NOT EXISTS email_log_tenant_idx ON email_log(tenant_id, created_at DESC);
