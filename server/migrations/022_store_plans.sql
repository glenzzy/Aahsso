-- Aahsso Store is buy, sell and keep records. Its two starting plans begin with the extra tools switched off;
-- a super admin can switch any of them back on in Plans. Only plans nobody has edited yet (no features set) are changed.
UPDATE plans SET modules = '{"onlineShop":false,"promos":false,"reminders":false,"autoReminders":false,"stockCount":false,"branches":false,"transfers":false,"labels":false,"cashHandover":false,"tills":false,"suppliers":false,"assets":false,"attendance":false,"leave":false,"payroll":false,"customRoles":false,"activity":false,"delivery":false,"emailReceipts":false}'::jsonb, updated_at = now()
  WHERE id = 'store-starter' AND modules = '{}'::jsonb;
UPDATE plans SET modules = '{"autoReminders":false,"tills":false,"assets":false,"attendance":false,"leave":false,"payroll":false}'::jsonb, updated_at = now()
  WHERE id = 'store-business' AND modules = '{}'::jsonb;
