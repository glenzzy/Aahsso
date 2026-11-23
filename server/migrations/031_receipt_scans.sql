-- Receipt scanning: each photo / PDF read by the AI (for the monthly scan limit and the cost in the admin).
-- Nothing of the receipt itself is stored here — only who scanned, when, how much was read and what it cost in tokens.
CREATE TABLE IF NOT EXISTS receipt_scans (
  id             bigserial PRIMARY KEY,
  tenant_id      uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id        uuid,
  created_at     timestamptz NOT NULL DEFAULT now(),
  files          int NOT NULL DEFAULT 0,
  counted        boolean NOT NULL DEFAULT false, -- reached the AI (counts toward the month's limit)
  receipts       int NOT NULL DEFAULT 0,
  lines          int NOT NULL DEFAULT 0,
  model          text,
  input_tokens   int NOT NULL DEFAULT 0,
  output_tokens  int NOT NULL DEFAULT 0,
  ms             int,
  error          text
);
CREATE INDEX IF NOT EXISTS receipt_scans_tenant_month_idx ON receipt_scans (tenant_id, created_at);
