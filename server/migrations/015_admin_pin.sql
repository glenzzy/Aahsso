-- A 4-digit PIN each admin creates, asked again before sensitive actions ("Confirm it is you"). Stored as a bcrypt hash.
ALTER TABLE platform_admins ADD COLUMN IF NOT EXISTS pin_hash text;
ALTER TABLE platform_admins ADD COLUMN IF NOT EXISTS pin_set_at timestamptz;
