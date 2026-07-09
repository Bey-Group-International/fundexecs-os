-- 20260709120000_office_invite_tokens.sql
--
-- Server-enforced, single-use invite links for the Executive Floor.
--
-- A floor / meeting invite email now carries a per-recipient token
-- (`/command-center?...&invite=<token>`) instead of one shared link. The token
-- is validated and consumed server-side on join (see lib/office/invite-tokens.ts
-- and app/api/office/invite/validate/route.ts): it must not be expired, it is
-- single-use, and — for a signed-in joiner — it is tied to the invited email.
--
-- These tokens are secrets. The table is service-role-only: RLS is enabled with
-- NO authenticated/anon policies, so only the service client (which bypasses RLS)
-- ever reads or writes them. A random authenticated user cannot enumerate or
-- redeem someone else's invite. Fully idempotent so a preview-branch replay is a
-- no-op. Absent this table, sendFloorInvites simply falls back to the shared
-- link (no `invite` param), so the office degrades gracefully.

create table if not exists public.office_invite_tokens (
  id               uuid primary key default extensions.gen_random_uuid(),
  token            text not null unique,
  email            text not null,
  room             text,
  meet             boolean not null default false,
  deal             text,
  inviter_id       uuid references public.principals (id) on delete set null,
  inviter_email    text,
  organization_id  uuid references public.organizations (id) on delete cascade,
  expires_at       timestamptz not null,
  used_at          timestamptz,
  used_by_email    text,
  created_at       timestamptz not null default now()
);

-- Redemption looks up by the opaque token; expiry sweeps scan expires_at.
create index if not exists office_invite_tokens_email_idx
  on public.office_invite_tokens (email);
create index if not exists office_invite_tokens_expires_idx
  on public.office_invite_tokens (expires_at);

-- Service-role-only: enable RLS and grant no policies. Only createServiceClient
-- (RLS-bypassing) touches this table; authenticated/anon roles get nothing.
alter table public.office_invite_tokens enable row level security;
