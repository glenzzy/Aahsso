-- Aahsso Bar & Resto: the drinks catalog bars pick from (Stock, Menu, New purchase). Filled by `npm run seed:drinks`
-- from server/data/drinks-cm.json (built from docs/aahsso_beverage_catalog_cameroon.xlsx). One row = one sellable drink:
-- every size and packaging is its own row. Prices are suggestions in XAF; each bar sets its own.
CREATE TABLE IF NOT EXISTS drinks_catalog (
  sku              text PRIMARY KEY,               -- BEER-0001
  market           text NOT NULL DEFAULT 'CM',     -- the country the list is for
  name             text NOT NULL,                  -- Castel Beer 650ml Bottle
  category         text NOT NULL,                  -- Beer, Spirits, Wine…
  subcategory      text,                           -- Lager, Cognac, Red…
  brand            text,
  variant          text,
  volume_ml        integer,
  packaging        text,                           -- Bottle (returnable), Glass, Can, Plastic, Carton, Served
  returnable       boolean NOT NULL DEFAULT false,
  units_per_case   integer,
  abv              numeric(5,2),                   -- % alcohol
  origin_country   text,
  region           text,
  grape_style      text,
  sweetness        text,
  producer         text,
  supplier         text,                           -- usual supplier in Cameroon
  price_tier       text,
  cost_xaf         integer,
  price_bar_xaf    integer,
  price_lounge_xaf integer,
  by_glass         boolean NOT NULL DEFAULT false,
  pour_ml          integer,
  pours_per_unit   numeric(8,2),
  barcode          text,
  confidence       text,                           -- High, Medium, Verify
  notes            text,
  active           boolean NOT NULL DEFAULT true,  -- false: no longer offered (kept for drinks bars already use)
  sort             integer NOT NULL DEFAULT 0,
  updated_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT drinks_catalog_packaging CHECK (packaging IS NULL OR packaging IN ('Bottle', 'Glass', 'Can', 'Plastic', 'Carton', 'Served'))
);
CREATE INDEX IF NOT EXISTS drinks_catalog_market_idx ON drinks_catalog (market, active, sort);

-- the catalog's notes and lists: notes, packaging, confidence levels, suppliers, price tiers, sweetness, title…
CREATE TABLE IF NOT EXISTS drinks_catalog_meta (
  market     text NOT NULL DEFAULT 'CM',
  key        text NOT NULL,
  value      jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (market, key)
);
