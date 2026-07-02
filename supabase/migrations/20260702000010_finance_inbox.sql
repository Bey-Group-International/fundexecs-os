-- 20260702000010_finance_inbox.sql
-- Finance in the Unified Inbox. Accounting and payments are the one counterparty
-- surface the inbox never covered: an overdue invoice, a bill awaiting approval,
-- or a failed payment is a decision that needs the operator just as much as a
-- reply or a booking does — it just lived in Xero / the payments rail instead of
-- the inbox. This adds a first-class `finance` pillar alongside messaging /
-- booking / video / signing, plus two native provider channels feeding it:
--
--   * xero — accounting: invoices, bills, and overdue/awaiting-approval alerts.
--   * jax  — payments: transactions, statements, and payment-status alerts.
--
-- Read-only ingest to start: these threads surface and triage like any other,
-- but the acting move (approve a bill, reconcile, pay) is reviewed in the
-- provider — so, like signing, a finance thread carries no inbox-originated
-- dispatch yet. The mock-or-real adapters (lib/integrations/adapters/finance)
-- and the channel catalog (lib/inbox/channels) mirror this same shape.

-- ---------------------------------------------------------------------------
-- A new inbox pillar for accounting/payments touchpoints. `add value if not
-- exists` is idempotent; the value is only USED at runtime (never in this
-- transaction), so it is safe inside the migration.
-- ---------------------------------------------------------------------------
alter type inbox_category add value if not exists 'finance';

-- ---------------------------------------------------------------------------
-- The two native finance provider channels. Same idempotent add-value pattern
-- as the ecosystem (0045) and deal_share (0046) channels before them.
-- ---------------------------------------------------------------------------
alter type inbox_channel add value if not exists 'xero';
alter type inbox_channel add value if not exists 'jax';
