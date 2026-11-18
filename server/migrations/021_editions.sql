-- Editions: the kind of business. 'import' (Aahsso Brocan: buy abroad, ship, receive, sell) or
-- 'store' (Aahsso Store: buy locally, sell, manage stock). Chosen at sign-up; only a platform admin changes it.
-- Every business that exists today is an importer.
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS edition text NOT NULL DEFAULT 'import';
ALTER TABLE tenants DROP CONSTRAINT IF EXISTS tenants_edition_check;
ALTER TABLE tenants ADD CONSTRAINT tenants_edition_check CHECK (edition IN ('import', 'store'));

-- Each plan is sold to one edition. Existing plans are import plans.
ALTER TABLE plans ADD COLUMN IF NOT EXISTS edition text NOT NULL DEFAULT 'import';
ALTER TABLE plans DROP CONSTRAINT IF EXISTS plans_edition_check;
ALTER TABLE plans ADD CONSTRAINT plans_edition_check CHECK (edition IN ('import', 'store'));

-- Starting plans for Aahsso Store: hidden, no prices, until a super admin sets them up (like the first import plans).
INSERT INTO plans (id, name, description, edition, sort, public) VALUES
  ('store-starter', 'Store Starter', 'For one shop: buy, sell and keep your stock right.', 'store', 11, false),
  ('store-business', 'Store Business', 'For a shop with a team, branches and credit customers.', 'store', 12, false)
ON CONFLICT (id) DO NOTHING;

-- Admins who manage businesses may switch a business between Import and Store.
UPDATE admin_roles SET perms = perms || '["tenants.edition"]'::jsonb, updated_at = now() WHERE id = 'admin' AND builtin AND NOT perms ? 'tenants.edition';
