-- Online shop address made from the store name: /s/mama-beauty. Unique across every business on Aahsso.
-- The old random key (shopId) keeps working and redirects to the new address.

-- Shops that already exist get an address from their business name (with -2, -3… when the name is taken).
DO $$
DECLARE r record; base text; cand text; n int;
BEGIN
  FOR r IN SELECT tenant_id, data FROM documents
           WHERE collection = 'settings' AND id = 'main'
             AND coalesce(data->>'shopSlug', '') = '' AND coalesce(data->>'shopId', '') <> ''
           ORDER BY updated_at
  LOOP
    base := translate(lower(coalesce(r.data->>'businessName', '')), 'àáâäãåçèéêëìíîïñòóôöõùúûüýÿ''’', 'aaaaaaceeeeiiiinooooouuuuyy');
    base := replace(base, '&', ' and ');
    base := trim(both '-' from regexp_replace(base, '[^a-z0-9]+', '-', 'g'));
    base := trim(both '-' from left(base, 36));
    IF length(base) < 3 OR base IN ('admin','api','app','www','aahsso','shop','shops','store','stores','login','signup','register','help','support','settings','orders','static','assets','new','test','demo') THEN
      base := 'shop-' || lower(r.data->>'shopId');
    END IF;
    cand := base; n := 1;
    WHILE EXISTS (SELECT 1 FROM documents WHERE collection = 'settings' AND id = 'main' AND lower(data->>'shopSlug') = cand) LOOP
      n := n + 1; cand := base || '-' || n;
    END LOOP;
    UPDATE documents SET data = jsonb_set(data, '{shopSlug}', to_jsonb(cand))
      WHERE tenant_id = r.tenant_id AND collection = 'settings' AND id = 'main';
  END LOOP;
END $$;

-- No two businesses can ever hold the same address (also safe when two owners save at the same moment).
CREATE UNIQUE INDEX IF NOT EXISTS settings_shop_slug_idx ON documents ((lower(data->>'shopSlug')))
  WHERE collection = 'settings' AND id = 'main' AND coalesce(data->>'shopSlug', '') <> '';
