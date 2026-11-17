-- Manager approval on the spot: a manager types their PIN on the cashier's phone to allow a risky action
-- (cancel, refund, discount below the minimum, over the credit limit). Wrong PINs lock it for a while.
ALTER TABLE users ADD COLUMN IF NOT EXISTS approval_pin_hash text;
ALTER TABLE users ADD COLUMN IF NOT EXISTS approval_pin_fails int NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS approval_pin_locked_until timestamptz;
