-- ============================================================================
-- Organization identity fields — logo, short description, website.
--
-- Additive + idempotent. The logo image itself reuses the existing public
-- `avatars` storage bucket (uploaded under the uploader's own {user_id}/ folder
-- so the current avatars RLS policy applies); only the resulting public URL is
-- stored here. Org name/type/tier already exist on this table.
--
-- Editing these is governed by the existing organizations RLS:
--   "admins update their org" → private.is_org_admin(id)
-- so no new policy is required.
-- ============================================================================

alter table public.organizations add column if not exists logo_url text;
alter table public.organizations add column if not exists description text;
alter table public.organizations add column if not exists website text;
