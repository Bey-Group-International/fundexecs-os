# Piloting skill auto-invocation on one organization

Auto-invocation lets the workflow engine run a **governed skill** in place of a free-text
step. It has always been global and off. This adds a per-organization opt-in so one org
can try it first. Nothing changes for any org that is not listed.

## Turn it on for one org

Set an environment variable on the deployment and redeploy:

```
SKILL_AUTOINVOKE_ORGS=<organization uuid>[,<another uuid>]
```

`SKILL_AUTOINVOKE_ENABLED=true` still turns it on for **every** org. Remove the org id and
redeploy to turn the pilot off; no data needs cleaning up.

## What has to be true for a step to run as a skill

A step runs as a skill only when it **clearly is one** (see `lib/skills/engine-bridge.ts`)
**and** the real input exists. Otherwise the normal free-text path runs, unchanged.

|                Step reads like                |      Skill       |                    Needs (all real records)                    |
|-----------------------------------------------|------------------|----------------------------------------------------------------|
| "Define the mandate screen"                   | `mandate-screen` | the org's saved mandate (`/settings/pe-firm`)                  |
| "First look at the teaser"                    | `first-look`     | the saved mandate **and** a deal linked to the workflow        |
| "Target screening of the catalog"             | `target-screen`  | the saved mandate **and** company rows in the sourcing catalog |
| "Source targets for the mandate"              | `source-deals`   | mandate screening criteria **and** company rows in the catalog |
| "Screen this opportunity against our mandate" | `screen-deal`    | mandate screening criteria **and** a linked deal               |

The other PE skills (QoE, bid range, covenants, exit…) need rich structured input that a
workflow does not reliably hold, so they still defer to free text. There is not yet a screen
for running them on typed input; to try them by hand, use the command-line tool in
[pe-hands-on-testing.md](./pe-hands-on-testing.md).

### Where the candidates come from

The org's `sourcing_entities` rows with `kind = 'company'`, most recently updated first, at
most 50 per step. Only what a row carries is forwarded:

- sector = the row's category tags joined with " / " (the screens match by substring);
- geography = the row's `geography`;
- revenue and EBITDA = `metadata.revenue` / `metadata.ebitda`, **only if stored as numbers**.

Every other metric is left absent, so `target-screen` reports it as `needs-data` instead of
guessing. A catalog with no sector, geography or size data will mostly return `needs-data`;
that is the correct answer, not a bug.

## Checking it worked

For a step-by-step script, including what you should see at each point, use
[pe-hands-on-testing.md](./pe-hands-on-testing.md).

1. Save a mandate at `/settings/pe-firm` (approve it, or results are labelled `default-screened`).
2. Run a workflow with a step such as "Target screening of the catalog".
3. Open the step's deliverable: it should show the skill's structured output and provenance,
   and the **Skills at work** feed should show a `skill_runs` row for `target-screen`.
4. A step that did not run as a skill simply produced free text. That means one of the
   requirements above was missing, which is safe.

## Safety

Auto-invoked output goes through the same grounding, critique and approval gate as any
deliverable. A skill never replaces an outbound action (tool dispatch takes precedence), and
no skill runs on invented input.
