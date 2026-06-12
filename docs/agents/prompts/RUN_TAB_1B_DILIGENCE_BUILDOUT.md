# Agent prompt — Run tab 1B: Diligence deep buildout

Follow-on to `RUN_TAB_1_DILIGENCE.md`. That agent delivers prototype
parity; this agent takes the Diligence center **beyond the prototype** —
making its promises real. Copy-paste prompt for the agent (read
`docs/agents/RUN_TABS_PLAYBOOK.md` first — it is binding):

---

You own the **Diligence** tab of the Run hub in
Bey-Group-International/fundexecs-os for a deep-buildout pass. Branch:
`agent/run-diligence-2` from current main — main MUST already contain the
parity work (the PR titled `Run tab — Diligence: prototype parity`); do
not start before it has merged. Territory (hard boundary, per the
playbook's tab-1 row): `components/run/StartDiligence.tsx`,
`components/run/DiligenceDocumentsPanel.tsx`, `lib/diligence/**`,
`lib/diligence-desk/**`, `lib/diligence-ui.ts`, `lib/queries/diligence.ts`,
`lib/actions/diligence.ts`, `app/(shell)/run/diligence/**`, plus one
additive migration if needed.

The parity pass made the center look and read like the prototype. Your
mission is to make it **true**. Today the verdict strip promises
"IC-ready" but no IC memo ever exists; the drawer says "logged to Chain
of Trust" but `lib/actions/diligence.ts` writes no
`chain_of_trust_records`; the orchestrator persists real citations on
every finding but the UI never shows the source documents; and a re-run
silently overwrites the last run's findings (`upsertFinding` is
delete-then-insert), so the record has no memory. Build out, in this
order:

1. **Real Chain of Trust logging.** The parity drawer's clear action and
   its "Cleared · logged to Chain of Trust" copy must be backed by real
   rows. Audit what the parity PR landed and close every gap: clearing a
   workstream inserts a `chain_of_trust_records` row (`entity_type`
   `'diligence_workstream'` + the finding's id), and a run reaching
   `complete` logs the run itself (`entity_type` `'diligence_run'`). See
   `lib/actions/trust.ts` for field usage, but do NOT edit that file —
   write the rows from your own server actions in
   `lib/actions/diligence.ts`. Idempotent: re-clearing or re-completing
   never duplicates rows.
2. **Evidence you can open.** The engine already retrieves chunks and
   persists `citations` (`{ document_id, file_name, quote }`) on every
   `diligence_findings` row (`lib/diligence/prompts.ts` defines the
   contract; `upsertFinding` in `lib/diligence/orchestrator.ts` stores
   it). Surface them: the resolution drawer's evidence block renders the
   real quotes with their source file names, each linking to the
   document (signed URL via the existing `diligence_documents` storage
   path, or an anchor into `DiligenceDocumentsPanel`). A finding with no
   citations says so honestly — "No source documents cited for this
   finding" — never decorative placeholder evidence. Citation → display
   mapping is pure in `lib/diligence-desk/` with `node:test` coverage
   (missing fields, empty arrays, dedupe by document).
3. **IC memo export.** Make "IC-ready" true. The synthesis already
   produces `memo`, `recommendation` and `followUpQuestions` per run —
   compose them, with the per-workstream findings and verdict, into a
   real IC memo: a pure `composeIcMemo()` in `lib/diligence-desk/`
   (unit-tested), rendered as a reviewable document and badged
   `Illustrative`. Filing runs through the ActionRunner approve loop and
   writes a `capital_materials` row — `kind` `'ic_memo'` is already in
   the `capital_materials_kind_check` constraint
   (`20260609210000_materials_studio.sql`) — so it lands in the data
   room. Idempotent: re-filing the same run updates rather than
   duplicates. `lib/dataroom/**` and `components/dataroom/**` are NOT
   yours; if the folder view needs to learn anything, leave a PR comment
   for that territory instead of editing their files.
4. **Re-run with memory.** `DiligenceDocumentsPanel` already nudges
   "re-run the review" after an upload, but a re-run erases the previous
   pass. Preserve history: each pass keeps its findings (new
   `diligence_runs` row per pass, or a versioned snapshot — additive
   migration if a column or table is missing) and the center surfaces
   **what changed** since the last pass — score moved, status flipped
   clear→flag, new follow-ups — in the matrix and drawer. Delta logic is
   pure in `lib/diligence-desk/` with tests. Re-running stays behind the
   approve loop; history is append-only and never silently rewritten.
5. **Matrix working-set tools.** The risk register gets the working-set
   treatment the Deal pipeline got in its expansion PR (#365): free-text
   search over specialist + headline, a status chip filter
   (clear/caution/flag), and a severity/confidence sort. Filtering logic
   is pure in `lib/diligence-desk/` with `node:test` coverage; a
   filtered-out matrix shows "No workstreams match · Clear filters",
   never the true empty state.

Out of scope (other slices own these): expanding the live analyst
committee to the prototype's 15-brain roster (the parity pass maps the
real bench into the matrix; growing the bench is a later wave),
e-signature, the public `/dr/[token]` surface, any edits to the hub
shell or other tabs' files.

Fidelity and house rules still apply in full: every mutation behind the
ActionRunner approve loop; honest data only (no fake rows, real empty
states); regulated outputs keep their `Illustrative` badges; pure logic
in `lib/diligence-desk/` with `node:test` unit tests; migrations
additive + idempotent with org-scoped RLS following
`20260611240000_closings_member_writes.sql`, with
`lib/supabase/database.types.ts` hand-patched to match.

Definition of done, gates, and PR format: per the playbook. Open a draft
PR titled `Diligence — buildout: evidence, IC memo, Chain of Trust & run
history`.
