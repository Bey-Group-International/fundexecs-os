# Shareable Beta Access Links (no-email magic links)

Refine the beta magic-link so an admin can generate a shareable invite **without
typing anyone's email**, and a recipient can claim it with a polished,
on-brand experience.

## Decisions (locked)

| Area              | Decision                                                                                                                                                        |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Identity capture  | Generic link → branded **claim page** where the recipient signs in with **Google** or **their own email** (identity captured at claim time, not at generation). |
| Reusability       | **Reusable with a cap** — one link, claimable by up to N people (default **25**), each becoming their own account.                                              |
| Expiry / security | **14-day expiry** (configurable) + **revoke** anytime from the admin panel.                                                                                     |
| Visual scope      | **Admin panel card** (no email field) **+ recipient claim page** matching the login screen's aesthetic.                                                         |

## Why this is an architectural change

Supabase magic links are bound to a user identity: `auth.admin.generateLink()`
**requires an email** and `verifyOtp()` signs in a _specific_ user. So "no email
to generate" means shifting identity capture from the admin (types each email)
to the recipient (provides Google/email at claim time). The existing per-email
flow (`lib/actions/beta-invites.ts`) stays as-is; this is **additive**.

## Current state (for reference)

- `lib/actions/beta-invites.ts` — `inviteBetaUser(email, note)` upserts `beta_invites`, mints a token-hash link via `generateLink`, returns it.
- `app/auth/confirm/route.ts` — verifies token-hash via `verifyOtp`, marks invite accepted (`accept_beta_invite` RPC), redirects to `next` (default `/onboarding`).
- `app/admin/BetaInvitesPanel.tsx` — admin UI with the `LinkBox` copy pattern.
- `app/auth/callback/route.ts` — Google OAuth callback; honors a same-origin relative `?next=`.
- New beta users are auto-provisioned their own org via the `handle_new_user` trigger.
- RLS helper: `private.is_org_admin(org_id)`; updated-at trigger: `public.set_updated_at()`; org table: `public.organizations`.

## Data model (new migration)

`supabase/migrations/<timestamp>_beta_links.sql` — follow the
`20260606201000_beta_invites.sql` conventions (RLS, `set_updated_at`, indexes).

```sql
-- Shareable, multi-use beta access links (no email at generation).
create table if not exists public.beta_links (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  token text not null unique,            -- url-safe random bearer token (~32 bytes)
  label text,                            -- optional admin label e.g. "X/Twitter drop"
  role public.org_member_role not null default 'member',
  max_uses integer,                      -- null = unlimited; default set in app (25)
  used_count integer not null default 0,
  expires_at timestamptz not null,
  revoked boolean not null default false,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists beta_links_org_idx on public.beta_links (org_id);

create trigger set_updated_at before update on public.beta_links
  for each row execute function public.set_updated_at();

-- One claim row per (link, user); powers the admin "claims" view + cap.
create table if not exists public.beta_link_claims (
  id uuid primary key default gen_random_uuid(),
  link_id uuid not null references public.beta_links (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  email text,
  claimed_at timestamptz not null default now(),
  unique (link_id, user_id)
);

alter table public.beta_links enable row level security;
alter table public.beta_link_claims enable row level security;

-- Admins manage their org's links; claim path uses the SECURITY DEFINER fn below.
create policy "admins manage beta links" on public.beta_links
  for all to authenticated
  using (private.is_org_admin(org_id))
  with check (private.is_org_admin(org_id));

create policy "admins read beta link claims" on public.beta_link_claims
  for select to authenticated
  using (exists (
    select 1 from public.beta_links bl
    where bl.id = link_id and private.is_org_admin(bl.org_id)
  ));

-- Atomic, idempotent claim. Runs as service role from /beta/claim/complete.
-- Returns { ok: boolean, reason: text }.
create or replace function public.claim_beta_link(
  _token text, _user_id uuid, _email text
) returns jsonb
language plpgsql security definer set search_path = public, private as $$
declare
  l public.beta_links;
  already boolean;
begin
  select * into l from public.beta_links where token = _token for update;
  if not found then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  if l.revoked then return jsonb_build_object('ok', false, 'reason', 'revoked'); end if;
  if l.expires_at <= now() then return jsonb_build_object('ok', false, 'reason', 'expired'); end if;

  select exists(
    select 1 from public.beta_link_claims where link_id = l.id and user_id = _user_id
  ) into already;

  if already then
    return jsonb_build_object('ok', true, 'reason', 'already_claimed');
  end if;

  if l.max_uses is not null and l.used_count >= l.max_uses then
    return jsonb_build_object('ok', false, 'reason', 'full');
  end if;

  insert into public.beta_link_claims (link_id, user_id, email)
    values (l.id, _user_id, _email);
  update public.beta_links set used_count = used_count + 1 where id = l.id;

  return jsonb_build_object('ok', true, 'reason', 'claimed');
end $$;

revoke all on function public.claim_beta_link(text, uuid, text) from public, anon, authenticated;
```

> **Token storage:** stored raw so the admin can re-copy the link later (it's a
> bearer capability, exactly like the existing magic links). Controls are
> expiry + cap + revoke. If you prefer, store `sha256(token)` and accept that
> links can't be re-displayed — call that out if you change it.

Regenerate or hand-extend `lib/supabase/database.types.ts` for the two new
tables + the `claim_beta_link` RPC.

## Server actions — `lib/actions/beta-links.ts`

- `createBetaLink({ label?, role?, maxUses?, expiresInDays? })` — admin-gated
  (`is_org_admin`); generate a url-safe token (`crypto.randomBytes(32).toString('base64url')`);
  insert `beta_links` (default `maxUses: 25`, `expiresInDays: 14`); audit
  (`admin_actions`, `target_type: 'beta_link'`); return
  `{ ok, link: ` + "`${getSiteURL()}/beta/claim?token=...`" + ` }`.
- `revokeBetaLink(id)` — admin-gated; set `revoked = true`; audit.
- `claimBetaLinkWithEmail(token, email)` — **public** (no session yet):
  1. Validate the link is claimable (active, not revoked/expired/full) via a read.
  2. `generateLink({ type: 'invite', email, options: { redirectTo: ` + "`${getSiteURL()}/auth/confirm`" + ` } })`.
     - If it errors because the **email already exists**, return
       `{ ok: false, error: 'You already have an account — use "Continue with Google" or sign in.' }`
       (prevents signing a claimer into someone else's existing account).
  3. Build the confirm URL: `/auth/confirm?token_hash=...&type=...&next=` + `encodeURIComponent('/beta/claim/complete?token=' + token)`.
  4. Return `{ ok: true, url }`; the client navigates there → instant
     passwordless sign-in, then `/beta/claim/complete` records the claim.
  - Do **not** record the claim here (record post-auth, atomically).

## Routes / pages

- `app/beta/claim/page.tsx` (server) — read `?token=`, look up the link
  (service role read), compute claimable state. Render `ClaimView` when valid;
  render a friendly **invalid / expired / full / revoked** state otherwise.
- `app/beta/claim/ClaimView.tsx` (client):
  - **Continue with Google** → `window.location.assign('/api/auth/google?next=' + encodeURIComponent('/beta/claim/complete?token=' + token))`.
  - **Email form** → `claimBetaLinkWithEmail(token, email)` → on `{ url }` navigate to it; show returned errors inline.
- `app/beta/claim/complete/route.ts` (server, GET) — requires a session
  (post-Google or post-confirm); call `claim_beta_link(token, userId, email)`;
  on `ok` redirect `/onboarding`; on failure redirect
  `/beta/claim?token=...&error=<reason>` (or `/login?error=`).

> Verify `app/api/auth/google` forwards `next` through to `/auth/callback`
> (the login page already relies on `next`); `/auth/callback` already honors a
> same-origin relative `next`.

## Admin UI — `app/admin/BetaLinksPanel.tsx`

New card, wired into the admin portal next to (or above) `BetaInvitesPanel`.
Reuse `Card`, `SectionTitle`, `Button`, `Input`, `Badge`, and the `LinkBox` copy
pattern.

- **Generate form — NO email field.** Fields: `label` (optional), `role`
  (default member), `max uses` (default 25, blank = unlimited), `expires in days`
  (default 14). Button: **"Generate beta link."**
- On success: show `LinkBox` (copyable, with a short "reusable · expires in 14d ·
  0/25 claimed" caption).
- **Links table:** label, claims (`used/max` with a subtle progress bar),
  expires (relative), status badge (`active` / `expired` / `full` / `revoked`),
  actions (**Copy link**, **Revoke**).
- `lib/queries/beta-links.ts` → `getBetaLinks(orgId)` returns the rows + derived
  status, newest first.

## Claim page — visual

Mirror `app/login/page.tsx`:

- **Desktop two-column.** Left value panel (gradient, `EarnCoin`, a "Private
  beta" `Badge`, one-line value prop). Right: claim card.
- **Claim card:** headline "You're invited to the FundExecs OS private beta",
  subtext, **Continue with Google** button (reuse the Google SVG), divider,
  **email** input + **"Get my access link"** submit, fine print
  ("One-time setup · no password required · Secured by Supabase Auth").
- **Invalid states:** a single centered card with a clear message
  (expired / fully claimed / revoked / invalid) and a button back to the
  marketing site or `/login`.
- Fully responsive (stacks on mobile). Match tokens/spacing/typography of the
  login screen exactly.

## Security notes

- Email path uses `type: 'invite'` only → cannot sign a claimer into an
  **existing** account (no takeover via a shared link).
- `claim_beta_link` is `SECURITY DEFINER`, atomic (`for update`), idempotent
  (same user re-claiming doesn't double-count), and enforces revoke/expiry/cap.
- Direct table access is admin-only via RLS; the public claim path only touches
  the DB through the definer function + the trusted server action.
- Token is a 256-bit bearer secret in the URL; expiry + cap + revoke bound the
  blast radius.

## Edge cases

- Link expired / revoked / at cap → claim page shows the matching state; the
  RPC is the source of truth if a race slips through.
- Existing user opens link via **Google** → signs in normally; claim recorded
  (idempotent); onboarding gate routes them.
- Existing user via **email** → blocked with a "use Google / sign in" message.
- Same person opens the link twice → idempotent, no extra use consumed.
- Reusing an old per-email `beta_invites` link still works unchanged.

## Acceptance criteria

1. Admin can generate a shareable beta link **without entering an email**.
2. The link is reusable up to the cap (default 25), expires in 14 days, and is revocable.
3. Recipient claim page offers Google **and** email, matches the login aesthetic, and is responsive.
4. Claiming signs the user in (new account) and lands them in `/onboarding`.
5. Admin table shows claims used/max, expiry, and status; revoke takes effect immediately.
6. Existing-account email claims are safely blocked; cap/expiry/revoke are enforced atomically.
7. `npm run format:check`, `npm run lint`, `npm run typecheck`, `npm run build`, and Playwright e2e all pass.

## Out of scope

- Sending links by email (no SMTP) — links are copy/share only.
- Changing the existing per-email `beta_invites` flow (kept as a fallback).
- QR-code generation (nice-to-have; only if trivial).

## File checklist

- `supabase/migrations/<ts>_beta_links.sql`
- `lib/supabase/database.types.ts` (types for new tables + RPC)
- `lib/queries/beta-links.ts`
- `lib/actions/beta-links.ts`
- `app/admin/BetaLinksPanel.tsx` + wire into the admin page/view
- `app/beta/claim/page.tsx`, `app/beta/claim/ClaimView.tsx`, `app/beta/claim/complete/route.ts`
- (verify) `app/api/auth/google` passes `next` through
- (optional) Playwright smoke for the claim page render
