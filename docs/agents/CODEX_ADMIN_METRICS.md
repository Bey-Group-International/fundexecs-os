# Codex — Admin real platform metrics + invite→membership (backend lane)

**Goal.** Back the Admin portal's placeholder panels with **real** platform
metrics, and complete the invite flow so accepting an invite grants org
membership at the chosen role. Claude's UI (`CLAUDE_ADMIN_REFINEMENT.md`) codes
against the typed contracts below and degrades to honest placeholders until this
lands — implement the contract, don't change its shape.

## 1. `getAdminMetrics(orgId)` — real metrics loader

Implement the body of `lib/queries/admin-metrics.ts` (Claude ships the placeholder):

```
AdminMetrics {
  brains:  { total: number; embedded: number };       // ai_brains + embedding coverage
  vector:  { status: 'live'|'degraded'|'unknown'; chunks: number }; // pgvector store
  intake:  { queued: number; processed: number };     // knowledge intake throughput
  trust:   { layerCoverage: Record<'truth'|'concept'|'execution'|'work', number> }; // 0–100 across the org's deals
  placeholder: boolean;  // false once real
}
```

- Source from existing tables where possible (`ai_brains`, the pgvector
  knowledge-chunks table, `trust_events`/deal trust layers, any intake/embedding
  queue). Set `placeholder: false` when returning real data.
- If a metric needs aggregation, add an **additive, idempotent** migration with a
  `SECURITY DEFINER` function: pin `set search_path = ''`, schema-qualify every
  object, and member-gate via `private.is_org_member(org_id)`. No destructive DDL.
- Always resolve (never throw); RLS-scoped; degrade to zeros + `placeholder:true`
  on error so the page never breaks.

## 2. Invite → org membership on acceptance

- The UI mints invites via the existing `inviteBetaUser` magic-link plumbing and
  captures a desired **role**. Extend acceptance so redeeming the link creates
  (or updates) the `org_members` row for that user at the captured role,
  idempotently, scoped to the inviting org.
- Persist the desired role on the invite (reuse `beta_invites` metadata/note or a
  minimal additive column). Audit the grant via the existing `writeAudit` helper
  (`action_type: 'invite_accepted'`).
- No auth-bypass; respect RLS; only owners/admins can invite (already enforced).

## Process

- Apply migrations to the live DB, run `get_advisors` (lint + security) and
  resolve findings, regenerate `database.types.ts`, open a **draft PR**, CI green.
  Coordinate so Claude's UI PR (`claude/refine-admin`) and this backend PR don't
  collide on `app/settings/page.tsx` (Claude owns the page wiring; you own the
  loader body + SQL).
