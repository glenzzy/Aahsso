-- One person, several businesses (e.g. an Aahsso Brocan and an Aahsso Store) under one sign-in.
-- The person signs in with their own login; each extra business has an owner account linked to it (person_id),
-- which has no login of its own ('link:…', never typed) and is reached only by switching from inside the app.
ALTER TABLE users ADD COLUMN IF NOT EXISTS person_id uuid REFERENCES users(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS users_person_idx ON users(person_id) WHERE person_id IS NOT NULL;
