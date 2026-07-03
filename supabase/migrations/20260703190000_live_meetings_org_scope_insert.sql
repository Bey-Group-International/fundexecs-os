-- 20260703190000_live_meetings_org_scope_insert.sql
-- live_meetings' INSERT policy (20260701240000_live_meetings.sql, re-applied
-- idempotently in 20260702000001_meetings_rls_idempotent.sql) checks only
-- `host_id = auth.uid()` — it never validates that the caller actually
-- belongs to the organization_id on the row being inserted. Since
-- app/api/meetings/create/route.ts writes organization_id straight from the
-- request body with no membership check either, any authenticated user could
-- POST an arbitrary org id and have their meeting (attacker-controlled title,
-- host_id genuinely themselves) appear in a victim org's meeting list for
-- every one of ITS members — the SELECT policy already grants read access to
-- "organization_id IN (my memberships)", so once the row exists with a
-- victim's org id, that org's real members see it.
--
-- This mirrors the SELECT policy's own org-membership check onto INSERT: a
-- caller may still create an org-less meeting (organization_id IS NULL stays
-- allowed, matching the column's nullability and the SELECT policy's own
-- carve-out), but an org-scoped meeting now requires genuine membership in
-- that org, not just knowledge of its id.

DROP POLICY IF EXISTS "live_meetings_insert" ON live_meetings;

CREATE POLICY "live_meetings_insert" ON live_meetings FOR INSERT
  WITH CHECK (
    host_id = auth.uid()
    AND (
      organization_id IS NULL
      OR organization_id IN (
        SELECT organization_id FROM organization_members WHERE principal_id = auth.uid()
      )
    )
  );
