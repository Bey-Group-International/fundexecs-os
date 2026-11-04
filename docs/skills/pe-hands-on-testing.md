# Trying the PE skills by hand

A test script for a person, not a developer. About 45 minutes. It covers the three things a
human can actually exercise today: the firm settings editor, the auto-invoke pilot, and a
command-line tool that runs any of the 22 PE skills on your own input.

Every "You should see" below was taken from real output, not written from memory.

## First: what you can and cannot do by hand

|           Path           |                                                 What it covers                                                  |                           You need                            |
|--------------------------|-----------------------------------------------------------------------------------------------------------------|---------------------------------------------------------------|
| **A. Settings editor**   | The eight firm files at `/settings/pe-firm`                                                                     | Owner or admin login on the deployed app                      |
| **B. Auto-invoke pilot** | `mandate-screen`, `first-look`, `target-screen` (and the older `source-deals`, `screen-deal`) inside a workflow | One env var and a redeploy, an approved mandate, catalog rows |
| **C. Command line**      | **All 22 PE skills**, on your own input                                                                         | A checkout of the repo with dependencies installed            |

**There is no screen where you type an input into a skill and run it.** A server action for that
exists (`runSkillInSession`) but nothing in the app calls it yet. So for 19 of the 22 skills,
Part C is the only way to try them by hand. Also: a workflow step like "Tax due diligence issues
list" does **not** run `tax-dd`. The planner routes only the five skills named above; everything
else falls back to ordinary free text. That is deliberate (those skills need structured input a
workflow does not reliably hold), but it means Part B cannot show you the due diligence skills.

Part C does not read your organization's saved settings. The firm's hurdles, limits and gate
owners are whatever you put in the input; anything left out falls back to the labelled standing
default. Parts A and B are where the saved settings matter.

---

## Part A: the settings editor (browser)

Sign in as an **owner or admin** and open `/settings/pe-firm` (the page is titled "Your firm's
settings"). Each file has a box, a status line, and buttons.

|  #  |                                                               Do                                                                |                                                                       You should see                                                                       |
|-----|---------------------------------------------------------------------------------------------------------------------------------|------------------------------------------------------------------------------------------------------------------------------------------------------------|
| A1  | Open the page.                                                                                                                  | Eight files. Each status reads **not set · standing default**.                                                                                             |
| A2  | **Return hurdles**: click **Insert starter**, then **Save**.                                                                    | Refused: "No usable base hurdle. Expected { "base": { "irr": 0.2, "moic": 2.5 }, … }". Nothing is saved; the status stays *not set*.                       |
| A3  | Type `{ nope` in Return hurdles.                                                                                                | Red message starting "Not valid JSON:".                                                                                                                    |
| A4  | Replace it with `{"base":{"irr":0.2,"moic":2.5},"downside":{"irr":0.1,"moic":1.5},"holdYears":5}` and **Save**.                 | "Saved." Status becomes **saved · v1**.                                                                                                                    |
| A5  | **Financing limits**: save `{"maxSeniorLeverage":4,"covenantWarnHeadroomPct":20,"bogus":1,"maxTotalLeverage":"x"}`.             | Saves. Reload the page: only `maxSeniorLeverage` and `covenantWarnHeadroomPct` are stored. The junk fields are dropped, not kept.                          |
| A6  | **Evidence grades**: save `{"supportsPrice":{"A":true,"B":true,"C":false,"U":true}}`.                                           | Amber warning: Grade "U" (untested) can never support a price and cannot be changed; that value was ignored. Saved without `U`.                            |
| A7  | **Investment mandate**: **Insert starter**, **Save**.                                                                           | Saves as **draft**. Red "Blocks approval:" lines, e.g. *Hard limit "Geography" has no threshold. Ask for a number.* The starter has no numbers on purpose. |
| A8  | Click **Approve mandate** on that draft.                                                                                        | Refused. A starter cannot be approved.                                                                                                                     |
| A9  | Replace the box with the contents of `docs/skills/pe-hands-on/mandate-for-editor.json` and **Save**.                            | "Saved." Status **saved · v2 · draft**. No "Blocks approval" lines.                                                                                        |
| A10 | Click **Approve mandate**.                                                                                                      | "Mandate approved." Status **… · approved**. The button now reads **Approved**.                                                                            |
| A11 | Change any one character in the mandate and **Save**.                                                                           | Status goes back to **· draft**. *Editing un-signs it.* Approve again to restore.                                                                          |
| A12 | **IC memo structure**: save `{"sections":[{"key":"recommendation","required":true},{"key":"structure"}]}`.                      | Warning: Section 2 ("structure"): a section the skill does not generate needs a title. That section is dropped.                                            |
| A13 | **Firm and gate owners**: save `{"firmName":"Acme Capital","gateOwners":{"bid_price":"Jane Doe, deal lead","not_a_gate":"x"}}`. | Warning: Unknown gate(s) ignored: not_a_gate, followed by the list of known gates. `bid_price` is saved.                                                   |
| A14 | **Reporting style**: save `{"decimals":9}`.                                                                                     | Refused ("No usable reporting style…") with "decimals: must be a whole number from 0 to 4."                                                                |
| A15 | Click **Clear** on Return hurdles.                                                                                              | "Cleared — skills use the standing default." Status back to **not set · standing default**.                                                                |
| A16 | Sign in as an ordinary member (not owner/admin) and open the page.                                                              | You can read it, but there are no **Save**, **Approve mandate** or **Clear** buttons.                                                                      |

If you can see the audit log, there should be an entry for each save and for the approval. This
is the one check here I could not confirm from the code alone, so note what you find.

---

## Part B: the auto-invoke pilot (browser plus one deploy setting)

Skip this until a test organization is chosen. Nothing runs for any org not listed.

1. Set `SKILL_AUTOINVOKE_ORGS=<test org uuid>` on the deployment and redeploy.
2. Do A9 and A10 on that org (an **approved** mandate).
3. Make sure the org has some company rows in the sourcing catalog.

| #  |                              Do                               |                                                         You should see                                                         |
|----|---------------------------------------------------------------|--------------------------------------------------------------------------------------------------------------------------------|
| B1 | Run a workflow with a step "Target screening of the catalog". | The step's deliverable shows structured screening results. The session's **Skills at work** panel lists a `target-screen` run. |
| B2 | Look at a company row with no sector, geography or size.      | Its results say *not provided … cannot be tested* (`needs-data`). It is **not** guessed as a pass or a fail. That is correct.  |
| B3 | Run a step "First look at the teaser" with a deal linked.     | A `first-look` run appears in **Skills at work**.                                                                              |
| B4 | Edit the mandate (A11) and re-run B1 *without* approving.     | Results are labelled **default-screened**. Approve the mandate and they stop being so labelled.                                |
| B5 | Run a step "Tax due diligence issues list".                   | **No skill run.** Ordinary free text. (See "First" above. If a `tax-dd` run appears, tell us.)                                 |
| B6 | Remove the org id, redeploy, repeat B1.                       | No skill run. The pilot is off, and nothing needs cleaning up.                                                                 |

---

## Part C: the command line (all 22 skills)

On a machine with the repo and `npm ci` done. Every command below runs from the repo root.

```bash
npx tsx --tsconfig tsconfig.json scripts/try-pe-skill.ts --list
```

Lists the 22 skills with their human gates.

```bash
npx tsx --tsconfig tsconfig.json scripts/try-pe-skill.ts --all
```

Runs every skill on its shipped example. **Every row should say `ok`.** You should see:

```
bid-range                  ok      completeness 100%  flagged  0  The IC sets the price. This note informs it.
cash-13-week               ok      completeness  50%  flagged  2  The portfolio company CFO owns the forecast.
covenant-watch             ok      completeness 100%  flagged  0  The portfolio CFO and the fund's finance lead sign the compliance certificate.
data-room-prep             ok      completeness  15%  flagged  1  Counsel approves the redaction list before the room opens.
debt-structure             ok      completeness 100%  flagged  0  The financing lead approves the structure before lenders see it.
exit-readiness             ok      completeness 100%  flagged  2  The deal lead decides launch timing.
exit-routes                ok      completeness 100%  flagged  0  The IC approves the exit route.
final-investment-report    ok      completeness  80%  flagged  1  The IC reviews the report.
financing-terms            ok      completeness 100%  flagged  0  The financing lead selects the lender group. This note ranks; it does not choose.
first-look                 ok      completeness  75%  flagged  0  The deal lead owns the go / no-go. …
ipo-readiness              ok      completeness 100%  flagged  0  The board decides whether to pursue the listing.
kpi-variance               ok      completeness  50%  flagged  0  The deal lead reviews trend classifications.
legal-dd                   ok      completeness  75%  flagged  4  Deal counsel reviews and owns the legal findings.
mandate-screen             ok      completeness 100%  flagged  0  Managing Partner signs the mandate screen. …
operational-dd             ok      completeness  75%  flagged  4  The operating partner signs the improvement register.
qoe-bridge                 ok      completeness 100%  flagged  0  The financial DD lead signs the adjusted EBITDA figure. …
red-flag-register          ok      completeness  29%  flagged  5  The deal lead and a partner agree the treatment for every walk-away and price item.
revenue-quality            ok      completeness 100%  flagged  0  The deal lead decides whether concentration needs price, structure or a condition.
sensitivity                ok      completeness  80%  flagged  0  The IC chooses which case the price rests on. This analysis informs the choice.
target-screen              ok      completeness 100%  flagged  0  An associate reviews every pass before outreach.
tax-dd                     ok      completeness  75%  flagged  3  The tax adviser confirms each exposure before it moves into the price or SPA.
technology-dd              ok      completeness  100%  flagged  2  A technical reviewer confirms the risk ratings.
```

Two things to notice: **every skill names a human gate**, and **no skill says it approves anything**.

### Try to break it

The point of these is that the skills should **refuse to guess**. In each case the right answer
is a flag, not a number.

| #  |                                            Run                                             |                                                                                                                                    You should see                                                                                                                                     |
|----|--------------------------------------------------------------------------------------------|---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| C1 | `echo '{}' \| npx tsx --tsconfig tsconfig.json scripts/try-pe-skill.ts debt-structure -`   | Status **failed**, "Your input was rejected", listing `dealName`, `entryEbitda`, `tranches`, `base` as required. The skill never runs on invalid input. (18 of the 22 do this.)                                                                                                       |
| C2 | `echo '{}' \| … scripts/try-pe-skill.ts legal-dd -`                                        | Runs, but **0% complete**: every expected document shown as a gap, no coverage stated. Summary says "That is not a clean bill". (`tax-dd`, `technology-dd`, `operational-dd` behave the same.)                                                                                        |
| C3 | `… try-pe-skill.ts bid-range docs/skills/pe-hands-on/bid-range-defaults.json`              | A walk-away price, with "Return hurdles: standing default: gross IRR 20%, MOIC 2.5x [run on default settings — set root-returns]" listed under **Assumptions**, and "Run on default hurdles." in the summary. "downside not tested".                                                  |
| C4 | `… try-pe-skill.ts sensitivity docs/skills/pe-hands-on/sensitivity-minimal.json`           | Base returns 15.06% IRR, 2.0167x, **misses** the default hurdle. Three break-evens: entry multiple max **6.74x**, exit multiple min **11.8x**, growth min **13.6%**, each "short by …". Flags "No drivers to flex" and "No named cases supplied": it does not invent ranges or cases. |
| C5 | `… try-pe-skill.ts target-screen docs/skills/pe-hands-on/target-sparse.json`               | `basis: default-screened` (the mandate has no approval). "Sparse Co" has several lines like *Sector not provided — "Excluded sectors" (Side letter 2) cannot be tested.* It is not scored as a pass.                                                                                  |
| C6 | `… try-pe-skill.ts tax-dd docs/skills/pe-hands-on/tax-range-no-basis.json`                 | "Exposure range ignored for: Possible permanent establishment" (a range with no basis is not given). "Open year not reconciled: UK 2023", graded **U**. Range total is empty.                                                                                                         |
| C7 | `… try-pe-skill.ts technology-dd docs/skills/pe-hands-on/technology-capacity-breach.json`  | **Red**: "Capacity breached under the plan: orders/min (projected 1080 vs capacity 1000)". **Amber**: "No penetration test report seen". Pen test status `none`.                                                                                                                      |
| C8 | `… try-pe-skill.ts operational-dd docs/skills/pe-hands-on/operational-no-plan-volume.json` | Capacity status **plan-volume-missing** ("has no plan volume — it uses the plan's own number and was not run"). "Lean line rebalancing" is flagged untested; its saving is *ignored: no basis is stated*. "No site visit recorded".                                                   |

### Your own data

Copy a shipped example, change the numbers, and run it:

```bash
cp skills/bid-range/examples/example-1.json my-bid.json
# edit my-bid.json
npx tsx --tsconfig tsconfig.json scripts/try-pe-skill.ts bid-range my-bid.json
```

The fields each skill accepts are in `skills/<skill>/input.schema.json`. Add `--json` to get the
raw result. Nothing is saved or sent anywhere.

---

## The rules every skill should follow

Check these on whatever you try. A breach of any is a bug worth reporting.

1. **Nothing invented.** A figure you did not give is `null`, "not provided", or flagged, never estimated.
2. **Defaults are labelled.** Anything assumed appears under *Assumptions* and in the summary ("run on default settings").
3. **Missing inputs are flagged**, and the completeness score drops.
4. **No range or saving without a stated basis.** It is dropped with a reason.
5. **Evidence is graded A / B / C / U.** An item citing nothing is U; a U item never supports a price.
6. **A human gate is named, and the skill never approves.** The summary ends with who decides.
7. **An empty result is not "all clear".** It says what was not reviewed.

## What to send back

For each problem: the skill, the exact command or the exact JSON you used, what you expected,
and what you got (paste the output). "It looked wrong" is useful too if you say which line.

## Known gaps in what this script can tell you

- No screen runs a skill on typed input yet (above). Part C is a developer tool, not the product.
- Part C ignores saved organization settings; Parts A and B are the only checks of those.
- The settings editor's access rules (owner/admin only) are enforced in the database, but no
  automated test exercises them against a real database. A16 is the only check of that.
- The pilot has not been run on a real organization. Part B is the first time.

