-- Full activity history: what the record looked like after the change, who, where
ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS after jsonb;
ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS user_name text;
ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS location_id text;
CREATE INDEX IF NOT EXISTS audit_tenant_at_idx ON audit_log(tenant_id, at);
