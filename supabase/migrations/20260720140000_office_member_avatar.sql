-- 20260720140000_office_member_avatar.sql
-- Persist each Virtual Office member's customized pixel-art avatar.
--
-- The avatar is a small, serializable `AvatarConfig` (see
-- lib/office/avatarConfig.ts). It belongs to the member, not the org, so it
-- rides on the existing per-member row in `office_member_prefs`
-- (20260720130000) rather than a new table.
--
-- No new RLS is needed: `office_member_prefs` already enables row level
-- security with a self-manage policy set — SELECT scoped to the member's org
-- (office_member_prefs_select), and INSERT/UPDATE scoped to the member's own
-- row via `principal_id = auth.uid()` (office_member_prefs_insert /
-- office_member_prefs_update). Those row-level policies govern every column of
-- the row, so a member reading/writing their own `avatar` is already covered
-- and no per-column grant or additional policy is required.
--
-- Idempotent (`add column if not exists`) so a preview-branch replay is a no-op.

alter table public.office_member_prefs
  add column if not exists avatar jsonb;

comment on column public.office_member_prefs.avatar is
  'Member''s pixel-art AvatarConfig (lib/office/avatarConfig.ts); covered by the existing office_member_prefs self-manage RLS policies.';
