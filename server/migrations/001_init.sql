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
SELECT d.tenant_id, d.id AS sale_id, d.data->>'no' AS receipt_no, (p->>'date')::date AS paid_on, p->>'method' AS method,
       p->>'account' AS account, p->>'ref' AS reference, (p->>'amount')::numeric AS amount
FROM documents d, jsonb_array_elements(d.data->'payments') p WHERE d.collection = 'sales';

CREATE OR REPLACE VIEW v_lots AS
SELECT d.tenant_id, d.id AS lot_id, d.data->>'productId' AS product_id, (d.data->>'purchaseDate')::date AS purchase_date,
       d.data->>'vendor' AS vendor, d.data->>'sourceType' AS source_type, d.data->>'currency' AS currency,
       (d.data->>'unitCost')::numeric AS unit_cost, NULLIF(d.data->>'regularPrice','')::numeric AS regular_price,
       (d.data->>'qty')::numeric AS qty, NULLIF(d.data->>'expiry','')::date AS expiry, d.data->>'shipmentId' AS shipment_id
FROM documents d WHERE d.collection = 'lots';
