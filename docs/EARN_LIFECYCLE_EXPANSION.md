# Earn × the Executive Team — Closing the Lifecycle Loop

_How the Earn build-out expands past the close to add value across the **whole**
private-market lifecycle — and how it does so as **tasklets**: discrete,
signal-triggered, approve-ready units of work that each write one provable
record._

This extends `EARN_COMPOUNDING_VALUE.md` (the four flywheels, the 15-desk org,
the trust contract) and snaps onto the canonical 7-stage model in
`PRIVATE_MARKET_LIFECYCLE.md`. It is the **next** build direction once the Earn
foundation (`PR #383` → `/earn` page → real routing → task engine) lands.

**Decisions this doc encodes** (operator-confirmed, Jun-13):

| Question                           | Decision                                                                    |
| ---------------------------------- | --------------------------------------------------------------------------- |
| Which lifecycle gap first          | **Capital calls + LP reporting + re-up** — close the loop, Fund I → II      |
| How the team grows                 | **Add 2–3 new desks** for the post-close arc                                |
| How compounding extends            | **Add a 5th flywheel: Track Record** (returns → the next raise)             |
| Where honest post-close data lives | **Hybrid: integrations + attestations**, provenance labeled on every figure |

---

## 1. The gap: the lifecycle is a loop that doesn't close yet

The canonical model instruments seven stages — _establish truth → get
raise-ready → source LPs → convert LPs → source & execute deals → operate &
leverage → prove & compound._ Every desk in the org-chart serves the **front
half**: formation, the raise, sourcing, diligence, the close.

But a fund is not a line that ends at "Deal hits Committed → open the closing."
It is a **loop**. The work that actually fills an operator's years — and the
work that raises the _next_ fund — happens **after** the close:

| Post-close job (today: no desk owns it)   | Why it matters                                             |
| ----------------------------------------- | ---------------------------------------------------------- |
| **Capital calls**                         | Funding the commitments that were closed                   |
| **Portfolio monitoring & value-creation** | The multi-year stretch where returns are actually made     |
| **Interim marks / NAV**                   | The honest numbers every LP report and re-up depends on    |
| **Distributions / waterfall**             | Returning capital — the proof LPs underwrite               |
| **LP quarterly reporting**                | The cadence that keeps capital warm between funds          |
| **Re-up → Fund II**                       | The loop-back: a realized track record _is_ the next pitch |

The doc's strongest claim — _"the Chain of Trust is the appreciating asset"
(§5.7)_ — is currently **unfinished**. A ledger of formation steps and closings
is not yet a ledger of **returns**, and returns are what LPs buy. Closing the
loop is how the Chain of Trust grows from "provable steps" into "provable
performance."

**The thesis:** extend Earn through the **Administration & Re-up arc** so every
post-close action keeps compounding onto the record — then route that quantified
record back into Stage 3 (source LPs) for the next fund. The line becomes a
loop, and Fund I literally raises Fund II.

---

## 2. The chosen expansion — the Administration & Re-up arc (Stage 8 → loop-back)

A new arc bolts onto the canonical model after Stage 7, then **feeds Stage 3**:

```
1 Establish → 2 Raise-ready → 3 Source LPs → 4 Convert → 5 Deals → 6 Operate → 7 Prove
                     ▲                                                          │
                     │                                                          ▼
                     └──────────── 8 ADMINISTER & RE-UP ◄───────────────────────┘
                         capital calls · marks · distributions · LP reporting · re-up
```

Stage 8 is where the operator spends the fund's life — and where the record
compounds from "we closed deals" into "we returned capital." Its terminal
tasklet (a strong LP report + a realized mark) is the **opening tasklet of the
next fund's raise**. That hand-back is the loop closing.

---

## 3. The primitive: tasklets

Everything in this arc ships as **tasklets** — adopting and generalizing the
task-engine triggers from `EARN_COMPOUNDING_VALUE.md` §5.4 into a single,
reusable capability.

> **A tasklet is the atomic unit of the firm's work: one real signal → one
> pre-shaped, approve-ready draft, routed to one desk → one approval → one
> provable record.**

Every tasklet runs the same lifecycle, so the operator learns the shape **once**
and it holds across all 8 stages:

```
ARM  ──▶  FIRE        ──▶  DRAFT          ──▶  PRESENT        ──▶  APPROVE / EDIT / DISMISS  ──▶  EXECUTE        ──▶  RECORD + EMIT
(set the   (only on a real,   (Earn shapes it,    (one approve-     (the operator's            (the mutation       (writes 1 Chain-of-Trust /
 condition) observed signal)   routed to a desk)   ready card)       only job)                  runs)               Track-Record row → loop_event → re-arm)
```

**Tasklet capabilities** (what "adopt tasklet functionalities" buys us):

- **Signal-armed, not scheduled-spam.** A tasklet fires only when its real
  condition is met (`loop_event`, an integration webhook, a readiness delta) —
  never on a timer alone.
- **Honest-data gated.** A tasklet will not fire if its inputs aren't real. The
  draft states its provenance plainly (which integration / which attestation).
  No invented number ever reaches an approve card.
- **Routed to exactly one desk.** Each tasklet names its owner (the `personaFor`
  map decides), so the draft arrives in that specialist's voice with their prior
  outputs as context — the Routing flywheel.
- **Idempotent & auditable.** A tasklet won't double-fire on the same signal,
  and every fire/approve/dismiss is logged — the engine itself is on the record.
- **Approve-loop native.** A tasklet is the unit the operator approves. It
  **cannot** mutate anything unapproved. This is the trust contract enforced at
  the smallest grain.
- **Composable into close plans.** Sterling sequences tasklets into checklists
  (a capital-call run, a quarterly-close, a distribution waterfall) — so a
  multi-step process is just a chain of approve-ready tasklets.

This is the same primitive the front-half already implies; we're making it
**first-class** so the post-close arc is built _entirely_ out of it.

---

## 4. Tasklet catalog — the Administration & Re-up arc

Each row is a tasklet: a real signal → Earn drafts → a desk → one approval → one
record. Mirrors the §5.4 trigger table, extended through Stage 8 and the
loop-back.

| Tasklet (real signal)                        | Earn drafts → desk                                                       | Writes to                           |
| -------------------------------------------- | ------------------------------------------------------------------------ | ----------------------------------- |
| Deal funded / commitment drawn               | Capital-call notice + LP allocation schedule → **Beatrix**               | Chain of Trust (call issued)        |
| Quarter-end reached                          | Quarterly LP report (NAV, activity, marks) → **Beatrix / Eleanor**       | Track Record + IR cadence           |
| Portfolio co. posts new financials           | Interim mark update + variance note → **Rhea**                           | Track Record (mark, sourced)        |
| Covenant / runway flag trips                 | Portfolio-health alert + action plan → **Rhea / Sterling**               | Chain of Trust (risk logged)        |
| Exit event clears (sale / secondary)         | Distribution + waterfall calc → **Soren / Beatrix**                      | Track Record (realized DPI)         |
| DPI / TVPI crosses a threshold               | "Track-record update — ready to re-engage LPs" → **Sloane**              | Track Record → **loops to Stage 3** |
| LP report opened by a prospect for next fund | Warm re-up follow-up → **Eleanor**                                       | IR cadence (re-up pipeline)         |
| Fund period nears end                        | Re-up thesis + Fund II target list (seeded from Fund I LPs) → **Sloane** | The next raise (Stage 3)            |

**Honest-data rule (inherited & extended):** every figure above carries a
provenance tag — _pulled from {integration}_ or _attested by the operator on
{date}_. A tasklet that can't source its number honestly does not fire; it
surfaces a "needs real data" gap instead of guessing.

---

## 5. The new desks (2–3, with clean handoffs)

The arc needs specialists the current 15 don't cleanly cover. Each new desk
plugs into the existing relay — its output is another desk's input, exactly like
the org-chart in `EARN_COMPOUNDING_VALUE.md` §4.

| New specialist                                | Desk                      | Produces                                                         | Whose input it becomes                           |
| --------------------------------------------- | ------------------------- | ---------------------------------------------------------------- | ------------------------------------------------ |
| **Beatrix** · Fund CFO & Administration       | The fund's books          | Capital calls, NAV, distributions/waterfall, K-1s, the LP report | Eleanor (reporting), Sloane (re-up proof)        |
| **Rhea** · Portfolio Operations               | Post-close value-creation | Interim marks, KPI & covenant monitoring, value-creation plans   | Beatrix (marks feed NAV), Soren (exit readiness) |
| **Soren** · Realizations _(when exits begin)_ | Value capture             | Exit readiness, process, realized waterfall, DPI                 | Beatrix (distributions), Sloane (track record)   |

**Re-up is not a new desk** — it's Earn orchestrating the loop-back: when Beatrix
and Rhea have produced a quantified record, Earn routes it to **Sloane** (the
raise) and **Eleanor** (LP trust), who already own Stage 3. The two _required_
new desks for the chosen arc are **Beatrix** and **Rhea**; **Soren** joins the
moment the first exit is in sight. That satisfies "add 2–3 desks" without roster
sprawl, and keeps every desk a legible specialist.

**The compounding org insight, extended:** _a deal Marcus sources is only worth
what Adrian clears, Sloane funds, Eleanor keeps warm — and what **Rhea grows,
Soren realizes, and Beatrix returns to the LPs.**_ The relay now runs the full
loop, and the Chain of Trust makes every leg provable.

---

## 6. The fifth flywheel — Track Record

The four flywheels (Proof, Context, Routing, Momentum) all turn _within_ a fund.
The fifth turns _across_ funds — it's the one that closes the loop.

| Flywheel         | The loop                                                                                                                                                               | What the operator feels                                |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| **Track Record** | Every interim mark, distribution, and realized exit writes **returns proof** → DPI/TVPI rises → the next LP conversation and the re-up open from a quantified position | "Fund I isn't just done — it's the pitch for Fund II." |

_Compounds because:_ a fund's hardest sell is credibility, and **realized
returns are the only credibility LPs fully underwrite.** Proof logged formation;
Track Record logs _performance_. Each fund cycle hands the next a stronger
opening — the flywheel that makes the operator's whole _firm_ compound, not just
a single vehicle. It rides the same approve loop and the same record, so nothing
new has to be trusted: it's the existing asset, now denominated in returns.

---

## 7. Honest data — the hybrid sourcing model

The trust contract forbids invented data, and post-close numbers (NAV, IRR,
valuations, distributions) are the most consequential numbers in the system.
Sourcing is **hybrid**, with provenance on every figure:

- **Integrations as primary source of truth.** Where a system of record exists,
  the number is **pulled, not typed** — cap-table & valuation data (e.g. a Carta
  connector, already among this environment's integrations), fund-admin /
  accounting for NAV and distributions, signature platforms for re-up closings.
  A pulled figure is tagged _source: {integration}, as of {date}_.
- **Operator-attested entries where no integration exists.** The operator enters
  the mark/valuation as a **signed attestation against a real statement** — the
  same pattern wires and signatures already use (recorded, never faked). Tagged
  _attested by {operator}, {date}_.
- **Provenance is always visible.** Every number on a report, a mark, or a
  Track-Record row shows where it came from. A tasklet that can source neither
  way **does not fire** — it raises an honest gap instead.

This keeps the appreciating asset defensible: the longer the operator runs on
FundExecs OS, the more of their record is integration-sourced and the harder it
is to argue with.

---

## 8. The trust contract, extended to money movements

Stage 8 moves real money (calls, distributions), so the contract's money rule
matters most here — and it already covers it:

- **Money is recorded, not moved.** Capital calls and distributions are
  **attestations and instructions** against the operator's real bank and admin —
  no money flows through FundExecs OS, and the copy says so. The record proves
  the call was _issued_ and the distribution _instructed_, not that we wired it.
- **You decide, the team drafts.** Every call notice, mark, report, and re-up
  draft comes back through the approve loop as a tasklet. Earn never sends an LP
  a number unasked.
- **Every figure is provable.** Marks cite their source; distributions cite the
  waterfall; the LP report links to the Chain-of-Trust rows behind it.

---

## 9. How it maps to what's built — and what's next

| Layer                                              | Status                                               | Compounding role                                                       |
| -------------------------------------------------- | ---------------------------------------------------- | ---------------------------------------------------------------------- |
| Lifecycle Stages 1–7                               | Live (Fund Profile → Deal Desk → Memory Audit Trail) | The front half; readiness is the Proof flywheel's gauge                |
| Task-engine triggers (§5.4)                        | Next slice                                           | The tasklet primitive — generalize these into the first-class unit     |
| **Stage 8: Administration & Re-up arc**            | **This expansion**                                   | Closes the loop; the tasklet catalog (§4) is the build list            |
| **Beatrix · Fund CFO & Administration**            | New desk                                             | Capital calls, NAV, distributions, the LP report engine                |
| **Rhea · Portfolio Operations**                    | New desk                                             | Interim marks + portfolio health that keep the report honest & current |
| **Soren · Realizations**                           | New desk (when exits begin)                          | Realized returns → the Track Record flywheel                           |
| **Track Record flywheel**                          | New                                                  | Returns proof → the next raise (the loop-closer)                       |
| Hybrid data sourcing (integrations + attestations) | New, provenance-labeled                              | Keeps the appreciating asset defensible                                |

**Build order:** (1) make tasklets first-class on the existing engine; (2) ship
**Beatrix** (capital calls + quarterly LP report — the highest-frequency, most
valued post-close tasklets); (3) ship **Rhea** (interim marks feed Beatrix's
reports honestly); (4) add the **Track Record** surface so DPI/TVPI accrues; (5)
wire the **re-up loop-back** to Sloane/Eleanor; (6) add **Soren** when the first
exit appears.

---

## 10. The metric — the loop closes

The expansion is working when the operator feels the loop close:

- **The fund doesn't go quiet after the close.** Calls, marks, and reports arrive
  as approve-ready tasklets — the post-close years fill with decisions, not
  silence.
- **The record speaks in returns.** The Chain of Trust shows DPI/TVPI, not just
  formation steps. The next LP conversation opens from performance.
- **Fund II raises itself off Fund I.** The terminal tasklet of the raise — a
  strong report, a realized mark — is the **opening tasklet** of the next raise.
  Re-explaining goes to zero across funds, not just within one.

That is the whole bet, completed: **a firm that compounds across funds because
the loop running it finally closes.**

_Extends `EARN_COMPOUNDING_VALUE.md`. Encodes the Jun-13 lifecycle-expansion
decisions._
