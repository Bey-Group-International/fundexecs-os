-- Run › Onboarding: reminders for an LP who has not finished their setup.
--
-- An LP link lasts 7 days. On day 3 and day 6 an LP who has not yet submitted is
-- emailed a reminder from the fund manager's own connected mailbox (and only
-- then; no mailbox, no reminder). These two columns record that each reminder
-- was sent, so a sweep that runs hourly sends each at most once.
--
-- Additive and re-runnable. Existing rows get NULL: nothing has been sent.

alter table public.lp_onboarding_sessions
  add column if not exists reminded_day3_at timestamptz,
  add column if not exists reminded_day6_at timestamptz;

-- The sweep looks only at LPs who are still filling in the wizard.
create index if not exists lp_onboarding_sessions_reminder_idx
  on public.lp_onboarding_sessions (created_at)
  where review_state in ('not_started', 'in_progress');
