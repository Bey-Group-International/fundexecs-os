-- Fix: the admin (service_role) client could not persist integration tokens.
--
-- connections.ts reached private.integration_secrets via `.schema('private')`,
-- but `private` is not a PostgREST-exposed schema and service_role has no grants
-- there, so every token write failed ("Could not persist Google integration").
--
-- Rather than expose the secrets schema to the REST API, route access through
-- SECURITY DEFINER functions in the exposed `public` schema, callable ONLY by
-- service_role. private.integration_secrets stays unreachable from the API.
-- Additive + idempotent; search_path pinned (no advisor regressions).

create or replace function public.store_integration_secret(
  _connection_id uuid,
  _access_token text,
  _refresh_token text default null,
  _token_type text default null,
  _expires_at timestamptz default null
) returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into private.integration_secrets
    (connection_id, access_token, refresh_token, token_type, expires_at, updated_at)
  values (_connection_id, _access_token, _refresh_token, _token_type, _expires_at, now())
  on conflict (connection_id) do update set
    access_token = excluded.access_token,
    refresh_token = excluded.refresh_token,
    token_type = excluded.token_type,
    expires_at = excluded.expires_at,
    updated_at = now();
end;
$$;

create or replace function public.get_integration_secret(_connection_id uuid)
returns table (
  connection_id uuid,
  access_token text,
  refresh_token text,
  token_type text,
  expires_at timestamptz,
  updated_at timestamptz
)
language sql
security definer
set search_path = ''
as $$
  select connection_id, access_token, refresh_token, token_type, expires_at, updated_at
  from private.integration_secrets
  where connection_id = _connection_id;
$$;

-- Server-only: revoke from everyone, grant execute to service_role.
revoke all on function public.store_integration_secret(uuid, text, text, text, timestamptz)
  from public, anon, authenticated;
revoke all on function public.get_integration_secret(uuid)
  from public, anon, authenticated;
grant execute on function public.store_integration_secret(uuid, text, text, text, timestamptz)
  to service_role;
grant execute on function public.get_integration_secret(uuid)
  to service_role;
