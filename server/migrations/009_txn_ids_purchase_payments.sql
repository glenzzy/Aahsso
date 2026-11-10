-- Every sale and every purchase (supplier bill) has a transaction id.
-- Backfill older records with the same fallback the app shows (compute.js saleTxnId / billTxnId),
-- so the id people already saw on screen never changes.
UPDATE documents SET data = jsonb_set(data, '{txnId}', to_jsonb('TX-' || (data->>'no')))
WHERE collection = 'sales' AND COALESCE(data->>'txnId', '') = '' AND COALESCE(data->>'no', '') <> '';

UPDATE documents SET data = jsonb_set(data, '{txnId}', to_jsonb('PU-' || upper(regexp_replace(id, '^b_', ''))))
WHERE collection = 'bills' AND COALESCE(data->>'txnId', '') = '';

-- Supplier payments: amount and MoMo / OM charges as separate columns, with mode and transaction id.
CREATE OR REPLACE VIEW v_bill_payments AS
SELECT d.tenant_id, d.id AS bill_id, d.data->>'txnId' AS bill_txn_id, d.data->>'supplierId' AS supplier_id,
       d.data->>'description' AS description, d.data->>'currency' AS currency,
       p->>'id' AS payment_id, (p->>'date')::date AS pay_date,
       p->>'method' AS method, p->>'account' AS paid_to, p->>'ref' AS ref,
       (p->>'amount')::numeric AS amount,
       COALESCE((p->>'fee')::numeric, 0) AS fee,
       (p->>'amount')::numeric + COALESCE((p->>'fee')::numeric, 0) AS gross,
       p->>'by' AS paid_by, p->>'byId' AS paid_by_id
FROM documents d, jsonb_array_elements(COALESCE(d.data->'payments', '[]')) p
WHERE d.collection = 'bills';
