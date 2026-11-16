-- Platform admin: the new Users page (people who sign in to businesses). Built-in roles get the matching permissions.
UPDATE admin_roles SET perms = perms || '["users.view","users.write","users.delete"]'::jsonb, updated_at = now() WHERE id = 'admin' AND builtin AND NOT perms ? 'users.view';
UPDATE admin_roles SET perms = perms || '["users.view","users.write"]'::jsonb, updated_at = now() WHERE id = 'support' AND builtin AND NOT perms ? 'users.view';
UPDATE admin_roles SET perms = perms || '["users.view"]'::jsonb, updated_at = now() WHERE id = 'finance' AND builtin AND NOT perms ? 'users.view';
