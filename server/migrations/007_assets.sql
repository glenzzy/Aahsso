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
