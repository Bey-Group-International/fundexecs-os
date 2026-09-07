-- 20260906140000_access_request_decision_tokens.sql
-- One-click Approve / Decline from the internal access-request email.
--
-- The alert that goes to the @beygroupintl.com team now carries two buttons.
-- They have to work for someone reading mail on a phone with no session, so the
-- authority is a token in the link rather than a signed-in admin. That makes the
-- token itself the credential, and it is treated like one:
--
--   * Only its SHA-256 hash is stored. A leak of this table yields no usable
--     links.
--   * It expires (14 days — long enough to survive a holiday, short enough that
--     an old forwarded email is inert).
--   * It is single-use: recording a decision clears the hash, so the same link
--     cannot later flip a declined request to approved.
--   * The link only ever opens a CONFIRMATION page. Nothing is granted by the
--     GET itself, so a mail scanner or link prefetcher cannot approve anyone by
--     following it.
--
-- decided_via records which door a decision came through, because "approved by
-- whoever held the email link" and "approved by a named admin in the console"
-- are different facts and the audit trail should not conflate them.

alter table public.access_requests
  add column if not exists decision_token_hash       text,
  add column if not exists decision_token_expires_at timestamptz,
  add column if not exists decided_via               text;

-- Written as a separate guarded statement: ADD COLUMN ... CHECK is not re-runnable
-- once the column exists, and this repo's migrations must stay idempotent.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'access_requests_decided_via_check'
  ) then
    alter table public.access_requests
      add constraint access_requests_decided_via_check
      check (decided_via is null or decided_via in ('admin', 'email'));
  end if;
end $$;

-- The token lookup is the hot path for the decision page, and two live requests
-- must never share a hash.
create unique index if not exists access_requests_decision_token_idx
  on public.access_requests (decision_token_hash)
  where decision_token_hash is not null;
