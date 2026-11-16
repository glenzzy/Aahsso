-- Platform (super admin) + subscription plans, invoices and payments.
-- Admin accounts are separate from business users and are created only from the command line (scripts/admin.js).

CREATE TABLE IF NOT EXISTS platform_admins (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email            text NOT NULL UNIQUE,
  name             text NOT NULL,
  role             text NOT NULL DEFAULT 'owner' CHECK (role IN ('owner', 'support', 'finance')),
  password_hash    text NOT NULL,
  must_change_pw   boolean NOT NULL DEFAULT true,
  totp_secret      text,                    -- encrypted (AES-256-GCM) with ADMIN_SECRET
  totp_enabled     boolean NOT NULL DEFAULT false,
  totp_last_step   bigint,                  -- a code can be used only once
  recovery_codes   jsonb NOT NULL DEFAULT '[]', -- sha256 hashes, each usable once
  failed_attempts  int NOT NULL DEFAULT 0,
  locked_until     timestamptz,
  active           boolean NOT NULL DEFAULT true,
  created_at       timestamptz NOT NULL DEFAULT now(),
  last_login_at    timestamptz,
  last_login_ip    text
);

CREATE TABLE IF NOT EXISTS admin_sessions (
  id            text PRIMARY KEY,           -- sha256 of the cookie value (the cookie itself is never stored)
  admin_id      uuid NOT NULL REFERENCES platform_admins(id) ON DELETE CASCADE,
  created_at    timestamptz NOT NULL DEFAULT now(),
  last_seen_at  timestamptz NOT NULL DEFAULT now(),
  expires_at    timestamptz NOT NULL,
  reauth_at     timestamptz,                -- last time the admin re-confirmed with their code (sensitive actions)
  ip            text,
  user_agent    text,
  revoked_at    timestamptz
);
CREATE INDEX IF NOT EXISTS admin_sessions_admin_idx ON admin_sessions(admin_id, created_at DESC);

-- Half-way logins (password ok, code still needed). Short-lived.
CREATE TABLE IF NOT EXISTS admin_login_tickets (
  id          text PRIMARY KEY,             -- sha256 of the ticket
  admin_id    uuid NOT NULL REFERENCES platform_admins(id) ON DELETE CASCADE,
  purpose     text NOT NULL,                -- totp | setup
  expires_at  timestamptz NOT NULL,
  used_at     timestamptz
);

-- Every admin action. Rows can be added, never changed or removed.
CREATE TABLE IF NOT EXISTS admin_audit (
  id           bigserial PRIMARY KEY,
  admin_id     uuid,
  admin_email  text,
  action       text NOT NULL,
  tenant_id    uuid,
  target       text,
  details      jsonb,
  reason       text,
  ip           text,
  user_agent   text,
  at           timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS admin_audit_at_idx ON admin_audit(at DESC);
CREATE INDEX IF NOT EXISTS admin_audit_tenant_idx ON admin_audit(tenant_id, at DESC);
CREATE OR REPLACE FUNCTION admin_audit_append_only() RETURNS trigger AS $$
BEGIN RAISE EXCEPTION 'admin_audit is append-only'; END; $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS admin_audit_no_change ON admin_audit;
CREATE TRIGGER admin_audit_no_change BEFORE UPDATE OR DELETE ON admin_audit FOR EACH ROW EXECUTE FUNCTION admin_audit_append_only();

-- Platform settings edited in the dashboard (payment instructions, grace period…)
CREATE TABLE IF NOT EXISTS platform_settings (
  key         text PRIMARY KEY,
  value       jsonb NOT NULL,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  updated_by  uuid
);

CREATE TABLE IF NOT EXISTS plans (
  id             text PRIMARY KEY,           -- slug: starter, business…
  name           text NOT NULL,
  description    text NOT NULL DEFAULT '',
  price_monthly  integer,                    -- in currency units (FCFA); NULL = not sold monthly
  price_yearly   integer,                    -- NULL = not sold yearly
  currency       text NOT NULL DEFAULT 'XAF',
  limits         jsonb NOT NULL DEFAULT '{}', -- {maxUsers, maxLocations, maxProducts, onlineShop, payroll, autoReminders}; missing/null = unlimited / included
  features       jsonb NOT NULL DEFAULT '[]', -- lines shown on the plan card
  active         boolean NOT NULL DEFAULT true,  -- can be chosen
  public         boolean NOT NULL DEFAULT true,  -- shown to businesses
  sort           integer NOT NULL DEFAULT 0,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

-- One subscription per business. The tenants row keeps a copy of the current state (plan, status, dates) for fast checks.
CREATE TABLE IF NOT EXISTS subscriptions (
  tenant_id             uuid PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
  plan_id               text REFERENCES plans(id),
  status                text NOT NULL DEFAULT 'trialing' CHECK (status IN ('trialing', 'active', 'past_due', 'expired', 'suspended', 'cancelled')),
  cycle                 text NOT NULL DEFAULT 'monthly' CHECK (cycle IN ('monthly', 'yearly')),
  price                 integer,              -- price this business pays (kept when the plan price changes)
  currency              text NOT NULL DEFAULT 'XAF',
  trial_ends_at         timestamptz,
  current_period_start  timestamptz,
  current_period_end    timestamptz,
  grace_days            integer NOT NULL DEFAULT 7,
  suspended_reason      text,
  notes                 text,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS grace_days integer NOT NULL DEFAULT 7;

CREATE SEQUENCE IF NOT EXISTS invoice_seq START 1001;
CREATE TABLE IF NOT EXISTS invoices (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  number        text NOT NULL UNIQUE,
  tenant_id     uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  plan_id       text REFERENCES plans(id),
  cycle         text NOT NULL DEFAULT 'monthly',
  period_start  timestamptz,
  period_end    timestamptz,
  amount        integer NOT NULL CHECK (amount >= 0),
  currency      text NOT NULL DEFAULT 'XAF',
  status        text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'paid', 'void')),
  due_date      date NOT NULL,
  issued_at     timestamptz NOT NULL DEFAULT now(),
  paid_at       timestamptz,
  void_reason   text,
  created_by    text NOT NULL DEFAULT 'system'  -- system | owner (asked for by the business) | admin email
);
CREATE INDEX IF NOT EXISTS invoices_tenant_idx ON invoices(tenant_id, issued_at DESC);

CREATE TABLE IF NOT EXISTS payments (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  invoice_id    uuid REFERENCES invoices(id),
  amount        integer NOT NULL CHECK (amount > 0),
  currency      text NOT NULL DEFAULT 'XAF',
  method        text NOT NULL,
  reference     text,
  paid_on       date NOT NULL,
  status        text NOT NULL DEFAULT 'confirmed' CHECK (status IN ('pending', 'confirmed', 'rejected')), -- pending = the business says it paid; an admin checks
  provider      text NOT NULL DEFAULT 'manual',   -- manual now; a payment gateway later
  note          text,
  claimed_by    text,                             -- business user who reported it
  recorded_by   uuid,                             -- admin who confirmed / recorded it
  created_at    timestamptz NOT NULL DEFAULT now(),
  decided_at    timestamptz
);
CREATE INDEX IF NOT EXISTS payments_tenant_idx ON payments(tenant_id, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS payments_ref_idx ON payments(method, reference) WHERE reference IS NOT NULL AND reference <> '' AND status <> 'rejected';

CREATE TABLE IF NOT EXISTS support_tickets (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid REFERENCES tenants(id) ON DELETE CASCADE,
  user_id     uuid,
  user_name   text,
  email       text,
  topic       text NOT NULL,
  page        text,
  status      text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'answered', 'closed')),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS support_messages (
  id          bigserial PRIMARY KEY,
  ticket_id   uuid NOT NULL REFERENCES support_tickets(id) ON DELETE CASCADE,
  author      text NOT NULL CHECK (author IN ('user', 'admin')),
  admin_id    uuid,
  author_name text,
  body        text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS support_tickets_status_idx ON support_tickets(status, updated_at DESC);

-- The plan names the app already used. Prices are left empty and the plans hidden until a super admin sets them.
INSERT INTO plans (id, name, description, sort, public) VALUES
  ('starter', 'Starter', 'For a single shop getting started.', 1, false),
  ('business', 'Business', 'For growing businesses with a team and branches.', 2, false),
  ('enterprise', 'Enterprise', 'For large importers with many branches.', 3, false)
ON CONFLICT (id) DO NOTHING;

-- Every existing business gets a subscription matching what it has today.
INSERT INTO subscriptions (tenant_id, plan_id, status, trial_ends_at, current_period_end, current_period_start)
SELECT t.id,
       CASE WHEN t.plan IN ('starter', 'business', 'enterprise') THEN t.plan END,
       CASE WHEN t.status = 'suspended' THEN 'suspended'
            WHEN t.plan = 'trial' THEN (CASE WHEN t.trial_ends_at IS NULL OR t.trial_ends_at > now() THEN 'trialing' ELSE 'expired' END)
            WHEN t.paid_until IS NULL OR t.paid_until > now() THEN 'active'
            WHEN t.paid_until > now() - interval '7 days' THEN 'past_due'
            ELSE 'expired' END,
       t.trial_ends_at, t.paid_until, CASE WHEN t.plan <> 'trial' THEN t.created_at END
FROM tenants t
ON CONFLICT (tenant_id) DO NOTHING;
