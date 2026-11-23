-- Platform admin: users can be moved to Deleted (soft delete) and restored, or deleted permanently.
-- A deleted user cannot sign in (active = false), is hidden from the business's team, frees their plan seat and keeps their login reserved.
ALTER TABLE users ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
ALTER TABLE users ADD COLUMN IF NOT EXISTS deleted_by text;
ALTER TABLE users ADD COLUMN IF NOT EXISTS delete_reason text;
CREATE INDEX IF NOT EXISTS users_deleted_idx ON users (deleted_at) WHERE deleted_at IS NOT NULL;
