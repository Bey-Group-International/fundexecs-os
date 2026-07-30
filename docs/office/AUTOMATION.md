# Virtual Office — Hourly Enhancement Automation

This document is the standing brief for an automated, recurring task that makes
**one small, verified improvement per run** to the FundExecs virtual office
(`/office`). Each run is a fresh, memoryless session — this file plus the git
history and the log are the only memory. Read it fully before doing anything.

## Mission

Gradually enhance, optimize, and polish the virtual office over many small
hourly iterations. Quality over quantity. One focused improvement per run,
verified green, committed, and folded into a single rolling draft PR.

## Where the office lives

- **`public/office/map.html`** — the self-contained office world (~3k lines:
  inline CSS + JS; top-down + first-person nav, walkable avatars, day/night,
  build mode, character selector). This is the primary surface.
- **`app/(app)/office/`** — `page.tsx` (server, loads the member's avatar),
  `OfficeFrame.tsx` (iframe wrapper + `postMessage` avatar delivery),
  `builder/` (character builder).
- **`components/office/`**, **`lib/office/`** — avatar sprite generation,
  presets, config (has jest tests: `lib/office/*.test.ts`).
- The live page is auth-gated; work from source, don't rely on fetching it.

## Focus rotation

Rotate the focus area each run so improvements stay balanced. Pick the area by
run number `N` (see the log): `N mod 4`.

| N mod 4 |              Focus               |                                                                 Examples                                                                  |
|---------|----------------------------------|-------------------------------------------------------------------------------------------------------------------------------------------|
| 0       | **Visual & graphics polish**     | lighting, textures, furniture detail, avatars, day/night gradients, shadows, cohesive palette                                             |
| 1       | **Performance & load**           | shrink/dedupe CSS & JS in map.html, fewer reflows/repaints, `requestAnimationFrame` hygiene, asset/atlas size, lazy work off the hot path |
| 2       | **UX & interactivity**           | camera/controls feel, mobile & touch, build mode, character selector, hover/focus affordances, empty/loading states                       |
| 3       | **Accessibility & code quality** | keyboard nav, ARIA/roles, contrast, `prefers-reduced-motion`, readable/refactored sections, comments, tests in `lib/office`               |

If the chosen area has no clearly safe, high-value change this run, you may pick
the next area in rotation — but note in the log why you skipped.

## Guardrails (hard rules)

1. **Small diffs only.** One focused improvement. Keep it reviewable — roughly
   one feature/fix; avoid sprawling rewrites. If a change wants to be big, do
   the smallest valuable slice this run and leave the rest for a later run.
2. **Must build & pass tests before committing.** Run, in order:
   - `npm run lint`
   - `npm run typecheck`
   - `npm test`
   - `npm run build`
     If any of these was already failing on the branch *before* your change,
     note it and proceed only if your change is unrelated and doesn't worsen it.
     If **your** change breaks any of them and you can't fix it quickly, revert
     your change, log the attempt as skipped, and end the run cleanly. **Never
     commit a red build.**
3. **Changelog every run.** Prepend an entry to `docs/office/AUTOMATION_LOG.md`
   (newest first) — run number, date, focus area, what changed, files, verify
   result. This is how the next run knows where things stand.
4. **No new dependencies.** No new npm packages, external assets, fonts, CDN
   links, or network calls. Keep the office self-contained. If something truly
   needs a dependency, log it as a suggestion instead of adding it.
5. **Don't regress behavior.** Preserve existing controls, layouts, saved
   avatars, and the `postMessage` handshake (`fx-office-ready` / `fx-you`).
   Don't touch auth, Supabase schema, or unrelated app areas.
6. **Idempotent-ish.** Before adding something, check it isn't already there
   (fresh sessions can repeat themselves). Grep first.

## Workflow each run

1. `git fetch origin` and check out **`claude/fundexecs-office-automation-ui3w6h`**
   (this is the working branch; keep using it). Make sure you're up to date.
2. Read the top of `docs/office/AUTOMATION_LOG.md` to get the next run number
   `N` and see what recent runs did (avoid repeating).
3. Choose the focus area via `N mod 4`. Decide on ONE small improvement. Grep to
   confirm it isn't already done.
4. Make the change (prefer `map.html`; other office files as appropriate).
5. Verify: `npm run lint && npm run typecheck && npm test && npm run build`.
6. Prepend a log entry to `docs/office/AUTOMATION_LOG.md`.
7. Commit with a clear message (`Office (auto #N): <summary>`), push to the
   working branch with `git push -u origin <branch>` (retry with backoff on
   network errors).
8. Ensure the rolling **draft** PR into `main` exists and is open; if not,
   create it (draft). Do not open a second PR — reuse the existing one. Do not
   merge it. Keep the PR body's summary current if helpful.
9. End the run. Do not schedule anything — the Routine handles cadence.

## Notes

- Cadence: hourly, Mon–Fri, 9am–6pm US Central, via a Routine (cron
  `0 14-23 * * 1-5` UTC). The window follows a fixed UTC schedule, so in US
  Central winter (CST) it shifts to ~8am–5pm local; that's fine.
- The point is steady, safe compounding polish — not big swings. When in doubt,
  do less, but do it well and leave the tree greener than you found it.

