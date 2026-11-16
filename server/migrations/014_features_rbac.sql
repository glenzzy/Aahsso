-- 1) Plans switch every business feature on/off (plans.modules: {"payroll": false, …}; a missing key = included).
--    Counted limits stay in plans.limits (maxUsers, maxLocations, maxProducts).
ALTER TABLE plans ADD COLUMN IF NOT EXISTS modules jsonb NOT NULL DEFAULT '{}';
UPDATE plans SET
  modules = modules || jsonb_strip_nulls(jsonb_build_object(
    'onlineShop', CASE WHEN limits->>'onlineShop' = 'false' THEN false END,
    'payroll', CASE WHEN limits->>'payroll' = 'false' THEN false END,
    'autoReminders', CASE WHEN limits->>'autoReminders' = 'false' THEN false END)),
  limits = limits - 'onlineShop' - 'payroll' - 'autoReminders';

-- 2) A business can get its own deal: {"modules": {"payroll": true}, "limits": {"maxUsers": 10}} on top of its plan.
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS overrides jsonb NOT NULL DEFAULT '{}';

-- 3) Admin roles with granular permissions. The Super Admin is not a role row: it can do everything, and only it manages admins and roles.
CREATE TABLE IF NOT EXISTS admin_roles (
  id           text PRIMARY KEY,
  name         text NOT NULL,
  description  text NOT NULL DEFAULT '',
  perms        jsonb NOT NULL DEFAULT '[]',
  builtin      boolean NOT NULL DEFAULT false,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
INSERT INTO admin_roles (id, name, description, perms, builtin) VALUES
  ('admin', 'Admin', 'Everything except managing admins and roles',
   '["overview.view","tenants.view","subs.write","tenants.features","tenants.suspend","tenants.impersonate","tenants.resetOwner","billing","billing.write","billing.void","plans.view","plans.write","support","health.view","settings.write","audit.view","export"]', true),
  ('support', 'Support', 'Help businesses: view them, view as owner, reset owner passwords, answer tickets',
   '["overview.view","tenants.view","tenants.impersonate","tenants.resetOwner","support","plans.view","health.view"]', true),
  ('finance', 'Finance', 'Invoices, payments and subscriptions',
   '["overview.view","tenants.view","subs.write","billing","billing.write","billing.void","plans.view","export"]', true)
ON CONFLICT (id) DO NOTHING;
ALTER TABLE platform_admins DROP CONSTRAINT IF EXISTS platform_admins_role_check; -- roles now live in admin_roles ('super' is the one Super Admin)
