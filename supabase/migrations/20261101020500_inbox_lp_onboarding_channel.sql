-- LP onboarding alerts in the Unified Inbox: a thread when an LP submits (or
-- resubmits) their onboarding and is waiting for the fund manager's review
-- (lib/lp-submit-notice.server.ts). Their own channel so they are labelled and
-- filterable apart from other notices.
-- `add value if not exists` is idempotent.
alter type inbox_channel add value if not exists 'lp_onboarding';
