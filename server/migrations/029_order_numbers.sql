-- Aahsso Bar & Resto: order numbers per business, starting at 001. Drinks (bar) and food (kitchen) count separately:
-- an order with both gets one number of each (Bar #004 · Kitchen #002). Given by the server, so phones and QR orders never clash.
CREATE TABLE IF NOT EXISTS order_counters (
  tenant_id  uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  key        text NOT NULL,              -- 'bar' or 'kitchen'
  n          integer NOT NULL DEFAULT 0, -- the last number given
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, key)
);
