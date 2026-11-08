-- Businesses can define their own roles (settings.roles); validation moves to the API.
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
