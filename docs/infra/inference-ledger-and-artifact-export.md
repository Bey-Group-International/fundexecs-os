# Inference-Run Ledger + Artifact Document Export

**Status:** Landed, additive. Two independent backend infra items from the
documented backlog, built **in parallel** (two backend subagents) and integrated
centrally. Both are self-contained, dependency-free, and pure backend — no `app`
UI changes beyond one download route.

---

## 1. Inference-run telemetry ledger

The provider-agnostic inference gateway (`lib/inference/*`) already returned
telemetry (provider, model, token usage, latency, degraded) on every call. This
adds the durable, accountable **ledger** for it — the same discipline as
`skill_runs` and `dispatch_log`.

- **Migration `20260718180000_inference_runs.sql`** — `public.inference_runs`, an
  **append-only** ledger (no `updated_at`/trigger, no realtime — an immutable
  telemetry record). One row per gateway call: capability, resolved
  provider/model, prefer-tier, sensitivity, `ok`/`degraded`, input/output tokens,
  latency, a caller `purpose` label, optional session/workflow links, error.
  Org-scoped, member-read / writer-write RLS, idempotent.
- **`lib/inference/store.ts`** `persistInferenceRun` — server-only, best-effort,
  never throws; no-ops without a service env. Narrow unknown-cast (the table is new
  and DB types aren't regenerated), matching `lib/skills/store.ts`.
- **`lib/inference/logged.ts`** `runInferenceLogged(ctx, req)` — the persisted
  wrapper: runs `runInference` (pure gateway), records telemetry best-effort, and
  returns the result **unchanged**. A persistence failure can never affect the
  result. This is the `executeSkillCore` (pure) + `runSkill` (persists) pattern
  applied to inference.

**Not in this slice (follow-up):** routing `lib/claude.ts` through the gateway.
That is a change to the core LLM entry point and is deliberately deferred to its
own increment; this slice ships the ledger + logged wrapper so the telemetry
surface exists first.

## 2. Artifact document export (dependency-free)

Skill/step deliverables are stored as markdown `content` on `artifacts`. This makes
them **downloadable documents** with zero new dependencies:

- **`lib/artifacts/export.ts`** — pure, hand-rolled renderers (no markdown lib):
  - `renderMarkdownToRtf` — a valid RTF 1.0 document (opens natively in Word /
    Pages / Google Docs). Escapes `\{}`, tabs/newlines, and every non-ASCII
    codepoint as `\uN?`; headings → bold + sized, `**bold**`/`*italic*`/`` `code` ``,
    bullets, paragraphs.
  - `renderMarkdownToHtml` — a self-contained, print-styled HTML document (the
    "print to PDF" path); all text escaped, semantic tags per block.
  - `renderArtifact(format, content, title)` — dispatch; `md` returns raw content.
  - ReDoS-safe: input capped, line-based parsing, bounded inline tokenizer,
    unbalanced markers degrade to literal text — never throws.
- **`app/api/artifacts/[id]/export/route.ts`** — `GET ?format=rtf|html|md`
  (default `rtf`). `requireOrgContext` + RLS + explicit org filter (defense in
  depth); 400 on unknown format, 404 when the artifact isn't in the caller's org;
  returns the rendered document with the right `Content-Type` and a
  `Content-Disposition: attachment` filename slugified from the title.

**Why RTF/HTML, not binary `.docx`/`.pdf`:** both open as real documents
everywhere (RTF in Word, HTML → browser Save-as-PDF) with **no dependency and no
lockfile churn**. True binary `.docx` via the `docx` package is a later phase once
a dependency is approved — the renderer boundary (`renderArtifact`) is where that
plugs in.

## Verification

21 new tests (3 inference ledger + 18 export renderers); full suite **3666 green**,
typecheck + eslint clean. One additive migration; no RLS/dependency changes
elsewhere.

## Remaining backlog

- Route `lib/claude.ts` through the inference gateway (+ record via
  `runInferenceLogged`); real OpenAI/Google provider adapters.
- Binary `.docx`/`.pdf` export via an approved dependency, behind `renderArtifact`.
- A download affordance in the artifact UI (this slice ships the backend route).
