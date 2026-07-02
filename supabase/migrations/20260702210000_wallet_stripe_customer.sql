-- Add stripe_customer_id to wallets so we can open the Stripe Customer Portal
-- without a round-trip to the Stripe API to look up the customer by org.
alter table wallets add column if not exists stripe_customer_id text;
