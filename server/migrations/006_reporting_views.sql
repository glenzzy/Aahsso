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
SELECT d.tenant_id, d.id AS sale_id, p->>'id' AS payment_id, (p->>'date')::date AS pay_date,
       p->>'method' AS method, p->>'account' AS account, p->>'ref' AS ref,
       (p->>'amount')::numeric AS amount, p->>'by' AS received_by, p->>'byId' AS received_by_id
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
