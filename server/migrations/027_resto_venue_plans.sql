-- Bar & Resto plans are sold per venue: plans for bars only, for restaurants only, and for both.
-- plans.venue: 'bar' | 'restaurant' | 'both' for Bar & Resto plans; NULL for Brocan and Store plans.
-- A business's venue ("What do you run?") follows the plan it is on.
ALTER TABLE plans ADD COLUMN IF NOT EXISTS venue text;
ALTER TABLE plans DROP CONSTRAINT IF EXISTS plans_venue_check;

-- every Bar & Resto plan made so far covered bars and restaurants together
UPDATE plans SET venue = 'both', updated_at = now() WHERE edition = 'resto' AND venue IS NULL;
UPDATE plans SET venue = NULL WHERE edition <> 'resto' AND venue IS NOT NULL;
ALTER TABLE plans ADD CONSTRAINT plans_venue_check CHECK (
  (edition = 'resto' AND venue IN ('bar', 'restaurant', 'both')) OR (edition <> 'resto' AND venue IS NULL));

-- the two starting plans become the "Bar & Restaurant" plans (only where nobody has renamed or re-ordered them)
UPDATE plans SET name = 'Bar & Restaurant Starter', description = 'For a bar and restaurant together: menu, tables, QR orders, waiters and bills.', updated_at = now()
  WHERE id = 'resto-starter' AND name = 'Resto Starter';
UPDATE plans SET name = 'Bar & Restaurant Business', description = 'Kitchen and bar screens, reservations, recipes, loyalty, branches and every report.', updated_at = now()
  WHERE id = 'resto-business' AND name = 'Resto Business';
UPDATE plans SET sort = 25 WHERE id = 'resto-starter' AND sort = 21;
UPDATE plans SET sort = 26 WHERE id = 'resto-business' AND sort = 22;

-- starting plans for bars only and restaurants only: hidden and without prices until a super admin sets them up
INSERT INTO plans (id, name, description, edition, venue, sort, public, limits, modules) VALUES
  ('bar-starter', 'Bar Starter', 'For one bar: drinks menu, tables, QR orders, waiters and bills.', 'resto', 'bar', 21, false,
   '{"maxTables": 10}'::jsonb,
   '{"kds":false,"reservations":false,"recipes":false,"loyalty":false,"branches":false,"transfers":false,"waiterStats":false,"customRoles":false,"assets":false,"payroll":false,"leave":false,"autoReminders":false}'::jsonb),
  ('bar-business', 'Bar Business', 'Bar screen, sales by the glass, cocktails, happy hour, loyalty, branches and every report.', 'resto', 'bar', 22, false,
   '{}'::jsonb, '{}'::jsonb),
  ('restaurant-starter', 'Restaurant Starter', 'For one restaurant: menu, tables, QR orders, waiters and bills.', 'resto', 'restaurant', 23, false,
   '{"maxTables": 10}'::jsonb,
   '{"kds":false,"reservations":false,"recipes":false,"loyalty":false,"branches":false,"transfers":false,"waiterStats":false,"customRoles":false,"assets":false,"payroll":false,"leave":false,"autoReminders":false}'::jsonb),
  ('restaurant-business', 'Restaurant Business', 'Kitchen screen, reservations, recipes, loyalty, branches and every report.', 'resto', 'restaurant', 24, false,
   '{}'::jsonb, '{}'::jsonb)
ON CONFLICT (id) DO NOTHING;
