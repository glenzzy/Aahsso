-- Kargo database schema: all migrations in order (generated). In practice run: cd server && npm run migrate

-- ===== server/migrations/001_init.sql =====
-- Kargo SaaS schema (PostgreSQL 13+)
-- Business records are stored as JSON documents per tenant (same shape the frontend uses),
-- with relational tables for tenants, users and audit. Reporting views below flatten the JSON.

CREATE TABLE IF NOT EXISTS tenants (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name           text NOT NULL,
  plan           text NOT NULL DEFAULT 'trial',          -- trial | starter | business | enterprise
  status         text NOT NULL DEFAULT 'active',         -- active | past_due | suspended
  trial_ends_at  timestamptz,
  paid_until     timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS users (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name           text NOT NULL,
  login          text NOT NULL UNIQUE,                   -- email or phone, lower-cased
  password_hash  text NOT NULL,
  role           text NOT NULL CHECK (role IN ('owner','admin','manager','sales')),
  active         boolean NOT NULL DEFAULT true,
  created_at     timestamptz NOT NULL DEFAULT now(),
  last_login_at  timestamptz
);
CREATE INDEX IF NOT EXISTS users_tenant_idx ON users(tenant_id);

-- collections: settings, products, lots, shipments, customers, sales, adjustments, expenses
CREATE TABLE IF NOT EXISTS documents (
  tenant_id   uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  collection  text NOT NULL,
  id          text NOT NULL,
  data        jsonb NOT NULL,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  updated_by  uuid REFERENCES users(id) ON DELETE SET NULL,
  PRIMARY KEY (tenant_id, collection, id)
);
CREATE INDEX IF NOT EXISTS documents_tc_idx ON documents(tenant_id, collection);
CREATE INDEX IF NOT EXISTS documents_sale_date_idx ON documents(tenant_id, (data->>'date')) WHERE collection = 'sales';

CREATE TABLE IF NOT EXISTS audit_log (
  id          bigserial PRIMARY KEY,
  tenant_id   uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id     uuid REFERENCES users(id) ON DELETE SET NULL,
  action      text NOT NULL,          -- create | update | delete | import | login
  collection  text,
  doc_id      text,
  before      jsonb,
  at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS audit_tenant_idx ON audit_log(tenant_id, at DESC);

-- ---------- reporting views (for BI tools / SQL reports) ----------
CREATE OR REPLACE VIEW v_sales AS
SELECT d.tenant_id, d.id AS sale_id, d.data->>'no' AS receipt_no, (d.data->>'date')::date AS sale_date,
       d.data->>'customerId' AS customer_id, d.data->>'customerName' AS customer_name,
       d.data->>'status' AS status, (d.data->>'delivered')::boolean AS picked_up,
       COALESCE((d.data->>'discount')::numeric, 0) AS discount, d.data->>'createdBy' AS created_by
FROM documents d WHERE d.collection = 'sales';

CREATE OR REPLACE VIEW v_sale_lines AS
SELECT d.tenant_id, d.id AS sale_id, (d.data->>'date')::date AS sale_date, l->>'productId' AS product_id, l->>'name' AS item,
       (l->>'qty')::numeric AS qty, (l->>'unitPrice')::numeric AS unit_price, (l->>'qty')::numeric * (l->>'unitPrice')::numeric AS line_total
FROM documents d, jsonb_array_elements(d.data->'lines') l WHERE d.collection = 'sales' AND d.data->>'status' <> 'cancelled';

CREATE OR REPLACE VIEW v_payments AS
SELECT d.tenant_id, d.id AS sale_id, d.data->>'no' AS receipt_no, d.data->>'txnId' AS sale_txn_id,
       (p->>'date')::date AS paid_on, p->>'method' AS method,
       p->>'account' AS account, p->>'ref' AS reference, (p->>'amount')::numeric AS amount,
       COALESCE((p->>'fee')::numeric, 0) AS fee,
       (p->>'amount')::numeric + COALESCE((p->>'fee')::numeric, 0) AS gross
FROM documents d, jsonb_array_elements(d.data->'payments') p WHERE d.collection = 'sales';

CREATE OR REPLACE VIEW v_lots AS
SELECT d.tenant_id, d.id AS lot_id, d.data->>'productId' AS product_id, (d.data->>'purchaseDate')::date AS purchase_date,
       d.data->>'vendor' AS vendor, d.data->>'sourceType' AS source_type, d.data->>'currency' AS currency,
       (d.data->>'unitCost')::numeric AS unit_cost, NULLIF(d.data->>'regularPrice','')::numeric AS regular_price,
       (d.data->>'qty')::numeric AS qty, NULLIF(d.data->>'expiry','')::date AS expiry, d.data->>'shipmentId' AS shipment_id
FROM documents d WHERE d.collection = 'lots';

-- ===== server/migrations/002_roles_images.sql =====
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

-- ===== server/migrations/003_locations_reminders.sql =====
-- Staff can be tied to one location (shop / warehouse)
ALTER TABLE users ADD COLUMN IF NOT EXISTS location_id text;
-- Automatic reminder runs (one row per tenant per day, prevents double sending)
CREATE TABLE IF NOT EXISTS reminder_runs (
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  run_date  date NOT NULL,
  sent      int NOT NULL DEFAULT 0,
  at        timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, run_date)
);

-- ===== server/migrations/004_custom_roles.sql =====
-- Businesses can define their own roles (settings.roles); validation moves to the API.
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;

-- ===== server/migrations/005_activity.sql =====
-- Full activity history: what the record looked like after the change, who, where
ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS after jsonb;
ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS user_name text;
ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS location_id text;
CREATE INDEX IF NOT EXISTS audit_tenant_at_idx ON audit_log(tenant_id, at);

-- ===== server/migrations/006_reporting_views.sql =====
-- Read-only reporting views that flatten the JSON documents for SQL / BI tools (Metabase, Power BI, Excel).
DROP VIEW IF EXISTS v_sales, v_sale_lines, v_payments, v_lots, v_products, v_customers;
CREATE OR REPLACE VIEW v_sales AS
SELECT d.tenant_id, d.id, d.data->>'no' AS no, (d.data->>'date')::date AS sale_date,
       d.data->>'locationId' AS location_id, d.data->>'customerId' AS customer_id,
       d.data->>'customerName' AS customer_name, d.data->>'createdBy' AS created_by,
       COALESCE(d.data->>'status','open') AS status, COALESCE((d.data->>'delivered')::boolean, true) AS delivered,
       COALESCE((d.data->>'discount')::numeric,0) AS discount,
       (SELECT COALESCE(SUM((l->>'qty')::numeric*(l->>'unitPrice')::numeric),0) FROM jsonb_array_elements(COALESCE(d.data->'lines','[]')) l)
         - COALESCE((d.data->>'discount')::numeric,0) AS total,
       (SELECT COALESCE(SUM((p->>'amount')::numeric),0) FROM jsonb_array_elements(COALESCE(d.data->'payments','[]')) p) AS paid,
       d.updated_at
FROM documents d WHERE d.collection='sales';

CREATE OR REPLACE VIEW v_sale_lines AS
SELECT d.tenant_id, d.id AS sale_id, (d.data->>'date')::date AS sale_date, d.data->>'locationId' AS location_id,
       l.ord AS line_no, l.v->>'productId' AS product_id, l.v->>'name' AS name,
       (l.v->>'qty')::numeric AS qty, (l.v->>'unitPrice')::numeric AS unit_price,
       (l.v->>'qty')::numeric*(l.v->>'unitPrice')::numeric AS line_total,
       (SELECT COALESCE(SUM((r->>'qty')::numeric),0) FROM jsonb_array_elements(COALESCE(l.v->'returns','[]')) r) AS returned_qty
FROM documents d, jsonb_array_elements(COALESCE(d.data->'lines','[]')) WITH ORDINALITY l(v,ord)
WHERE d.collection='sales' AND COALESCE(d.data->>'status','open') <> 'cancelled';

CREATE OR REPLACE VIEW v_payments AS
SELECT d.tenant_id, d.id AS sale_id, d.data->>'no' AS sale_no, d.data->>'txnId' AS sale_txn_id,
       p->>'id' AS payment_id, (p->>'date')::date AS pay_date,
       p->>'method' AS method, p->>'account' AS account, p->>'ref' AS ref,
       (p->>'amount')::numeric AS amount,
       COALESCE((p->>'fee')::numeric, 0) AS fee,
       (p->>'amount')::numeric + COALESCE((p->>'fee')::numeric, 0) AS gross,
       p->>'by' AS received_by, p->>'byId' AS received_by_id
FROM documents d, jsonb_array_elements(COALESCE(d.data->'payments','[]')) p
WHERE d.collection='sales';

CREATE OR REPLACE VIEW v_lots AS
SELECT d.tenant_id, d.id, d.data->>'productId' AS product_id, (d.data->>'purchaseDate')::date AS purchase_date,
       d.data->>'vendor' AS vendor, d.data->>'sourceType' AS source_type, COALESCE(d.data->>'currency','USD') AS currency,
       (d.data->>'unitCost')::numeric AS unit_cost, (d.data->>'qty')::numeric AS qty,
       NULLIF(d.data->>'shipmentId','') AS shipment_id, d.data->>'locationId' AS location_id,
       NULLIF(d.data->>'expiry','')::date AS expiry, d.data->>'reservedFor' AS reserved_for
FROM documents d WHERE d.collection='lots';

CREATE OR REPLACE VIEW v_products AS
SELECT d.tenant_id, d.id, d.data->>'name' AS name, d.data->>'category' AS category, d.data->>'subcategory' AS subcategory,
       d.data->>'condition' AS condition, d.data->>'unit' AS unit, d.data->>'barcode' AS barcode,
       COALESCE((d.data->>'archived')::boolean,false) AS archived
FROM documents d WHERE d.collection='products';

CREATE OR REPLACE VIEW v_customers AS
SELECT d.tenant_id, d.id, d.data->>'name' AS name, d.data->>'phone' AS phone, d.data->>'whatsapp' AS whatsapp,
       d.data->>'city' AS city, d.data->>'type' AS type, NULLIF(d.data->>'creditLimit','')::numeric AS credit_limit
FROM documents d WHERE d.collection='customers';

-- For incremental sync (?since=) and change feeds
CREATE INDEX IF NOT EXISTS documents_updated_idx ON documents(tenant_id, collection, updated_at);

-- ===== server/migrations/007_assets.sql =====
-- Business assets (equipment, vehicles, tanks… owned and used, not for sale) live in documents(collection='assets').
-- This view flattens them for SQL / BI. Depreciation and value today are computed in compute.js (assetValue).
CREATE OR REPLACE VIEW v_assets AS
SELECT d.tenant_id, d.id, d.data->>'tag' AS tag, d.data->>'name' AS name, d.data->>'category' AS category,
       d.data->>'make' AS make, d.data->>'model' AS model, d.data->>'serialNo' AS serial_no,
       COALESCE(d.data->>'status','in_use') AS status, COALESCE(d.data->>'locationId','main') AS location_id, d.data->>'assignedTo' AS assigned_to,
       NULLIF(d.data->>'purchaseDate','')::date AS purchase_date, d.data->>'vendor' AS vendor,
       NULLIF(d.data->>'price','')::numeric AS price, d.data->>'currency' AS currency, NULLIF(d.data->>'fxRate','')::numeric AS fx_rate,
       NULLIF(d.data->>'extraCosts','')::numeric AS extra_costs, d.data->>'depMethod' AS dep_method,
       NULLIF(d.data->>'usefulLife','')::numeric AS useful_life_years, NULLIF(d.data->>'residualValue','')::numeric AS residual_value,
       NULLIF(d.data->'disposal'->>'date','')::date AS disposal_date, NULLIF(d.data->'disposal'->>'amount','')::numeric AS disposal_amount,
       NULLIF(d.data->'disposal'->>'bookValue','')::numeric AS book_value_at_disposal,
       NULLIF(d.data->>'nextServiceDate','')::date AS next_service, NULLIF(d.data->>'insuranceUntil','')::date AS insurance_until
FROM documents d WHERE d.collection='assets';
