-- Aahsso Store: suppliers are part of buying (who you bought from, what you still owe them), so Store Starter keeps them.
UPDATE plans SET modules = modules - 'suppliers', updated_at = now() WHERE id = 'store-starter' AND modules ? 'suppliers';
