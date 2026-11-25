-- Aahsso Bar & Resto: a photo for each drink in the catalog (a link to a freely licensed picture, e.g. Wikimedia Commons)
-- and who to credit for it. Bars get it as the starting photo of the stock item / menu item; they can change it.
ALTER TABLE drinks_catalog ADD COLUMN IF NOT EXISTS image_url text;
ALTER TABLE drinks_catalog ADD COLUMN IF NOT EXISTS image_credit text;
