-- How many businesses one owner can have is now set per plan (Stores on an Aahsso Store plan, Warehouses on a Brocan plan).
-- The platform setting stays as a safety limit over all kinds; its old default (3) becomes the new one (10).
UPDATE platform_settings SET value = '10'::jsonb, updated_at = now() WHERE key = 'maxBusinesses' AND value = '3'::jsonb;
