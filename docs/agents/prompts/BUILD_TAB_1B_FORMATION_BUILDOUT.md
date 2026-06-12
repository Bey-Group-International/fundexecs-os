# Agent prompt — Build tab 1B: Formation checklist deep buildout

Follow-on to `BUILD_TAB_1_FORMATION.md`. That agent delivered prototype
parity; this agent takes the Formation checklist **beyond the prototype** —
making its promises real. Copy-paste prompt for the agent (read
`docs/agents/BUILD_TABS_PLAYBOOK.md` first — it is binding):

---

You own the **Fund formation** tab of the Build hub in
Bey-Group-International/fundexecs-os for a deep-buildout pass. Branch:
`agent/build-formation-2` from current main — main MUST already contain the
parity work (`lib/formation/config.ts` matching
`docs/agents/prototype/build/formation.jsx.txt`); do not start before it has
merged. Territory (hard boundary, per the playbook): `components/formation/**`,
`lib/formation/**`, `app/(shell)/build/formation/**`, plus one additive
migration if needed.

The parity pass made the flow look and read like the prototype. Your mission
is to make it **true**. Today, `fileSteps()` animates "Filing to your data
room" and "Logging to your Chain of Trust", but `fileFormationStep` in
`lib/formation/actions.ts` only writes `fund_formations` + `formation_steps`.
Build out, in this order:

1. **Real Chain of Trust logging.** When a step files, insert a
   `chain_of_trust_records` row (the table exists —
   `supabase/migrations/20260604180000_…`; see `lib/actions/trust.ts` for
   field usage, but do NOT edit that file) with `entity_type`
   `'formation_step'` and the step's id, from within your own server action.
   The Complete screen's "logged to your Chain of Trust" line must be backed
   by real rows.
2. **Real data room filing.** A filed formation document becomes a
   `capital_materials` row (kind mapped from the `FormationKind`, `spec`
   carrying the decisions, stage `Ready`) so it appears in the Materials &
   data room tab's Legal & Terms folder. Write the row from
   `lib/formation/actions.ts` — `lib/dataroom/**` and
   `components/dataroom/**` are NOT yours; if the folder view needs to learn
   your kinds, leave a PR comment for the data-room agent instead of editing
   their files. Idempotent: re-filing must not duplicate rows.
3. **Drafted-document review.** `resultRows()` is a summary; build a full
   drafted-document view — a pure `composeFormationDoc()` (or similar) in
   `lib/formation/` (unit-tested) that renders each formed document's
   substance from its decisions, reachable from the checklist's Done rows
   ("Review") and from FormationComplete's Review CTA. Clearly badged
   `Illustrative` — these are working drafts, not legal instruments.
4. **Reopen & amend.** A Done step can be reopened: decisions editable, the
   wizard re-runs, re-approval re-files. Server action records the
   amendment (e.g. bump a `version`/`amended_at` on the `formation_steps`
   row — additive migration if a column is missing) and logs a fresh Chain
   of Trust entry. Amending never silently rewrites history.
5. **Server-enforced ordering.** `F_EDGES` dependencies (and the
   entity-before-LPA-style sequence) must be enforced in
   `fileFormationStep`, not just hidden in the UI — filing out of order
   returns a clear error the ActionRunner surfaces.
6. **Honest in-progress states.** `saveFormationDraft` already persists
   partial decisions; surface them — checklist rows distinguish Not
   started / In progress / Done from real saved data, and re-entering a
   partially decided wizard restores the saved answers.

Out of scope (other slices own these): e-signature/DocuSign, the public
`/dr/[token]` surface, any edits to the hub shell or other tabs' files.

Fidelity and house rules still apply in full: every mutation behind the
ActionRunner approve loop; honest data only (no fake rows, real empty
states); pure logic in `lib/formation/` with `node:test` unit tests;
migrations additive + idempotent with org-scoped RLS following
`20260611240000_closings_member_writes.sql`, with
`lib/supabase/database.types.ts` hand-patched to match.

Definition of done, gates, and PR format: per the playbook. Open a draft PR
titled `Formation checklist — buildout: real filings, drafts & amendments`.
