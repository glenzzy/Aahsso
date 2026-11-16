-- One Super Admin (created with scripts/admin.js); every other admin is added by the Super Admin in the dashboard.
-- Roles: super (one only) | admin (everything except managing admins) | support | finance.
ALTER TABLE platform_admins DROP CONSTRAINT IF EXISTS platform_admins_role_check;
-- the earliest owner becomes the Super Admin, other owners become Admins
UPDATE platform_admins SET role = 'super'
 WHERE id = (SELECT id FROM platform_admins WHERE role = 'owner' ORDER BY active DESC, created_at LIMIT 1)
   AND NOT EXISTS (SELECT 1 FROM platform_admins WHERE role = 'super');
UPDATE platform_admins SET role = 'admin' WHERE role = 'owner';
ALTER TABLE platform_admins ADD CONSTRAINT platform_admins_role_check CHECK (role IN ('super', 'admin', 'support', 'finance'));
ALTER TABLE platform_admins ALTER COLUMN role SET DEFAULT 'support';
CREATE UNIQUE INDEX IF NOT EXISTS platform_admins_one_super ON platform_admins ((true)) WHERE role = 'super';
