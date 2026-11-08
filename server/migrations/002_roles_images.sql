-- Per-person permission overrides on top of the role preset (see public/compute.js ROLES/PERMS)
ALTER TABLE users ADD COLUMN IF NOT EXISTS perms jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (role IN ('owner','admin','manager','sales','viewer'));

-- Product photos (kept in the database for simple deployment; move to S3/R2 at scale)
CREATE TABLE IF NOT EXISTS images (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  content_type  text NOT NULL,
  data          bytea NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS images_tenant_idx ON images(tenant_id);
