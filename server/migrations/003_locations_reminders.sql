-- Staff can be tied to one location (shop / warehouse)
ALTER TABLE users ADD COLUMN IF NOT EXISTS location_id text;
-- Automatic reminder runs (one row per tenant per day, prevents double sending)
CREATE TABLE IF NOT EXISTS reminder_runs (
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  run_date  date NOT NULL,
  sent      int NOT NULL DEFAULT 0,
  at        timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, run_date)
);
