-- Payment fee + transaction id columns on the reporting view (document JSON already holds fee / txnId / ref).
DROP VIEW IF EXISTS v_payments;
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
