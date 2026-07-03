-- Track whether an org has already received the email-verification trial grant
-- so the idempotency check is a single indexed lookup rather than a ledger scan.
alter table wallets add column if not exists trial_granted_at timestamptz;
