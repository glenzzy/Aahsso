-- Aahsso Bar & Resto: the third kind of business (bars, restaurants, or both).
ALTER TABLE tenants DROP CONSTRAINT IF EXISTS tenants_edition_check;
ALTER TABLE tenants ADD CONSTRAINT tenants_edition_check CHECK (edition IN ('import', 'store', 'resto'));
ALTER TABLE plans DROP CONSTRAINT IF EXISTS plans_edition_check;
ALTER TABLE plans ADD CONSTRAINT plans_edition_check CHECK (edition IN ('import', 'store', 'resto'));

-- Starting plans: hidden and without prices until a super admin sets them up and publishes them.
-- Starter: menu, tables, QR orders, waiters and bills, 10 tables. Business: everything, no table limit.
INSERT INTO plans (id, name, description, edition, sort, public, limits, modules) VALUES
  ('resto-starter', 'Resto Starter', 'For one bar or restaurant: menu, tables, QR orders, waiters and bills.', 'resto', 21, false,
   '{"maxTables": 10}'::jsonb,
   '{"kds":false,"reservations":false,"recipes":false,"loyalty":false,"branches":false,"transfers":false,"waiterStats":false,"customRoles":false,"assets":false,"payroll":false,"leave":false,"autoReminders":false}'::jsonb),
  ('resto-business', 'Resto Business', 'Kitchen and bar screens, reservations, recipes, loyalty, branches and every report.', 'resto', 22, false,
   '{}'::jsonb, '{}'::jsonb)
ON CONFLICT (id) DO NOTHING;
