-- The free trial is 5 days (fixed in the code: billing.FREE_TRIAL_DAYS). Trials started with the old 30-day default
-- now end 5 days after the business signed up. The platform admin can still give a business more time ("Extend").
UPDATE subscriptions s SET trial_ends_at = t.created_at + interval '5 days', updated_at = now()
  FROM tenants t
 WHERE t.id = s.tenant_id AND s.status = 'trialing' AND s.trial_ends_at > t.created_at + interval '5 days 1 hour';
UPDATE tenants t SET trial_ends_at = s.trial_ends_at
  FROM subscriptions s
 WHERE s.tenant_id = t.id AND s.status = 'trialing';
DELETE FROM platform_settings WHERE key = 'trialDays'; -- no longer a setting
