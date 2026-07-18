# Engine Skill Auto-Invocation (behind a flag)

**Status:** Landed, additive, **default-OFF**. This is the first vertical slice of
mid-loop skill auto-invocation: the workflow engine can now run a **governed skill**
in place of a free-text step generation — but only when the step maps to a skill
**and** real structured input is present, and only when an operator opts in. With
the flag off (the default), the engine's behaviour is byte-for-byte unchanged.

This closes the gap documented since the skill runtime landed: skills could run
inside a session with explicit input, but the engine had no structured input to
feed them mid-workflow, and we refuse to run a skill on fabricated input.

---

## The missing piece: structured screening criteria

The mandate carried free-text `scope`/`guardrails` (for the gate layer) but **no
machine-readable criteria** a skill could consume. Free-text can't be fed to a
skill without parsing/fabrication. This slice adds:

- **`mandates.screening_criteria`** (migration `20260718160000`) — a nullable jsonb
  column holding structured criteria (`sectors`, `geographies`, revenue/EBITDA/EV
  bands, `transactionTypes`, `exclusions`) in exactly the shape `screen-deal` and
  `source-deals` already accept. Additive; existing rows and legacy gate paths are
  unchanged. Null = no criteria (a silent dimension is never a fabricated bound).
- **`parseScreeningCriteria`** (`lib/skills/screening-criteria.ts`) — a defensive,
  pure parser that keeps only well-typed values and drops garbage; returns null
  when nothing valid survives. Never coerces or invents.
- **`getActiveScreeningCriteria`** (`lib/mandates.ts`) — reads the active mandate's
  criteria, best-effort, kept separate from the gate-layer `getActiveMandate` so
  legacy decision paths stay byte-for-byte identical.

## The planner — real input or nothing

`planSkillForStep(title, description, context)` (`lib/skills/skill-planner.ts`,
pure) answers: *can this step run as a native skill on REAL input we already have?*
It returns a plan (skill id + permitted executive + assembled input) **only when**:

1. the step clearly **is** a skill (`detectSkillForStep`), **and**
2. the structured context carries the skill's **required** input for real — a
   company name + usable mandate criteria for `screen-deal`; a supplied candidate
   set for `source-deals` — never invented.

Otherwise it returns null and the engine's free-text path runs unchanged. The
planner forwards **only fields that are actually present**; a missing field is left
absent so the skill's own core flags it — it is never filled in. Detectable skills
whose rich structured input isn't reliably present mid-workflow (`returns`,
`ic-memo`, `dd-checklist`) deliberately **defer** rather than run on fabricated input.

## Engine wiring — additive, gated, review-preserving

Behind `SKILL_AUTOINVOKE_ENABLED` (`lib/skills/config.ts`, off unless `"true"`):

- `executeWorkflow` assembles a `SkillPlanningContext` once per workflow — the
  mandate's criteria plus a deal **already linked** to the workflow (a real record;
  absent for most first-run workflows, in which case the planner defers).
- In the step loop, a step that plans to a skill runs `executePlannedSkill`
  (`lib/skills/engine-run.ts`) instead of `executeStep`. Its rendered output flows
  through the **same** artifact / grounding / critique / approval pipeline as any
  deliverable — review is never bypassed, and no second artifact is created. A
  governed rejection or failure is handled exactly like any other step failure.
- A best-effort `skill_runs` evidence row records the governed execution so it
  surfaces in the "Skills at work" feed.

External-action (tool-dispatch) steps still take precedence — a skill only ever
replaces a free-text generation, never an outbound action.

## Guardrails preserved

- **Never invent financial values.** The planner assembles input from present
  fields only; the skill flags whatever is missing. No skill runs on fabricated
  input — that is the whole reason auto-invocation waited for structured criteria.
- **Default off.** The flag gates the criteria fetch, the context assembly, the
  planning call, and the execution branch. With it off, nothing changes.
- **Review intact.** Auto-invoked output is a normal step deliverable — same
  approval gate, same grounding/critique, same artifact.

## Verification

22 new tests (parser, planner, engine-run, detection); full suite **3645 green**,
typecheck + eslint clean.

## Remaining (follow-ups)

- Populate `screening_criteria` from the mandate UI (this slice adds the column +
  read path; authoring UI is a separate front-end change).
- Broaden the planning context: link a deal to a workflow earlier (so `screen-deal`
  fires on first-run sourcing/screening workflows, not only continuations), and
  thread a candidate set through for `source-deals`.
- Planner-emitted tags from the LLM planner (today detection is deterministic
  regex); an explicit `skillId` on a planned step would remove the guesswork.

