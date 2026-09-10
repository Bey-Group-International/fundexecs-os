-- How an org wants to pay.
--
-- Until now the rail was chosen for the operator by preferredRoute: pull from a
-- linked account if there is one, otherwise print wire details, otherwise take a
-- card. That is a sensible default and a poor answer to "I would rather pay by
-- card" — the money moves in a way nobody asked for, at a speed nobody was told
-- about.
--
-- Null is a real and common value: it means "no preference, pick for me", which
-- is exactly the behaviour every existing org has today. Backfilling a default
-- here would silently commit every one of them to a rail they never chose.
alter table public.wallets
  add column if not exists preferred_route text
  check (preferred_route is null or preferred_route in ('ach_debit', 'card', 'transfer'));

comment on column public.wallets.preferred_route is
  'Settlement rail the org chose at the paywall. Null = decide automatically (preferredRoute). Honoured only while the org can actually be settled that way; capability still wins.';
