# Binary DOCX/PDF Export + Front-End Surfaces

**Status:** Landed, additive. Makes two recent backend slices usable end to end:
the artifact export route now serves **real `.docx` and `.pdf`**, a **download menu**
surfaces every format in the artifact viewer, and the mandate settings page gains a
**structured screening-criteria editor** that writes `mandates.screening_criteria`.
Built partly in parallel (three subagents) and integrated centrally.

---

## 1. Binary DOCX/PDF export

The dependency-free renderers (RTF/HTML/Markdown) shipped earlier at the
`renderArtifact` boundary. This adds the real binary formats behind that same seam,
reusing the existing hand-rolled markdown parser (`parseBlocks` / `parseInline`,
now exported from `lib/artifacts/export.ts`).

- **`lib/artifacts/export-binary.ts`** (owns the `docx` + `pdf-lib` deps):
  - `renderMarkdownToDocx` — a real Word document via `docx` (`Document` / `Packer`):
    title + H1–H3, bullets, italic blockquotes, Courier code lines, HR borders,
    inline bold/italic/code runs.
  - `renderMarkdownToPdf` — a real PDF via `pdf-lib`: US-Letter pages with margins,
    a page-break cursor, per-span font selection (Helvetica / Bold / Oblique /
    Courier), **WinAnsi sanitization** so StandardFonts never throw on smart
    quotes / dashes / non-Latin-1, O(N) word-wrap, and a try/catch fallback to a
    minimal valid one-page PDF. Never throws.
  - `renderArtifactBinary(format, content, title)` — dispatch.
- **`lib/artifacts/export.ts`** — `ExportFormat` now includes `docx`/`pdf`;
  `isBinaryFormat`, content types, and extensions extended; `renderArtifact` stays
  the synchronous string path (text formats only). The parser primitives are
  exported so the binary module reuses them (no duplicated markdown logic).
- **`app/api/artifacts/[id]/export/route.ts`** — `?format=rtf|html|md|docx|pdf`.
  Binary formats are rendered to bytes and returned as an `ArrayBuffer` (a valid
  `BodyInit`) with the correct content type; text formats unchanged. Same
  `requireOrgContext` + explicit org filter + attachment filename.

New deps: `docx` ^9.7.1, `pdf-lib` ^1.17.1 (both chosen for pure-JS, server-side
rendering — no headless browser).

## 2. Artifact download menu

`components/ArtifactViewer.tsx` — `ArtifactActions` gains an optional `id` and,
when present, a **Download ▾** dropdown (bespoke `useState` menu matching the
existing toolbar styling) with one link per format:
Word (.docx) · PDF (.pdf) · Rich text (.rtf) · Web page (.html) · Markdown (.md),
each an `<a download href="/api/artifacts/${id}/export?format=…">`. Auth is
cookie-based, so a plain link downloads for the signed-in user. `id` is threaded
from both `ArtifactInline` call sites (so the menu appears inline and in the
modal). When `id` is absent the original client-Blob fallback is kept — no
regression.

## 3. Mandate screening-criteria editor

Surfaces the `screening_criteria` column the engine already reads:

- **`components/mandate/CriteriaEditor.tsx`** — a client section with chip inputs
  (sectors / geographies / transaction types / exclusions) and numeric band inputs
  (min/max revenue, min/max EBITDA, max EV), reusing the existing ChipInput and
  number-field patterns; submits via named/hidden inputs through the parent form.
- **`components/mandate/MandateEditor.tsx`** — renders the editor, seeded from the
  parsed criteria.
- **`app/(app)/settings/mandate/page.tsx`** — reads + parses the column
  (`parseScreeningCriteria`) and passes it in.
- **`app/(app)/settings/mandate/actions.ts`** — `saveMandate` reads the fields,
  runs them back through `parseScreeningCriteria` (defensive; null when empty), and
  writes `screening_criteria` on both the update and insert paths.
- **`lib/mandates.ts`** — `getActiveMandateRow` now selects the column too.

The full loop is now closed: an operator authors structured criteria in the UI →
they persist → `getActiveScreeningCriteria` feeds them to the engine's skill
planner (behind `SKILL_AUTOINVOKE_ENABLED`).

## Verification

Full Jest suite **3676 green** (binary-renderer magic-byte tests + format-helper
coverage), typecheck + eslint clean. No new migration. First front-end change of
this workstream — the UI reuses existing components/patterns throughout.

## Remaining backlog

- Route `lib/claude.ts` through the inference gateway (+ `runInferenceLogged`) and
  real OpenAI/Google adapters — the last backend seam.
- Optional: richer PDF layout (tables, page numbers) if artifact bodies grow tables.

