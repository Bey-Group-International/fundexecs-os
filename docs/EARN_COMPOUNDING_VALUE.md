# Earn × the Executive Team — Compounding Value

_A user's-lens north star for the Earn Copilot and the 15-person executive
team. How each feature is built so it does not just help once — it compounds:
every approved move makes the next one faster, sharper, and more provable._

This sits beside `DASHBOARD_V2_COMPOUNDING.md` (the command center's compounding
model) and the hub playbooks. It is the **why** the Earn build-out slices
(`PR #383` foundation → `/earn` page → real routing → task engine) chase.

---

## 1. The promise, in the operator's words

> "I set the mandate. The team works. I approve. And every time I approve,
> the whole machine gets a little stronger."

A fund operator does not want a chatbot. They want a **firm** — an executive
team that runs the fundraise while they execute, hands them only the decisions
that need a human, and turns every decision into permanent, provable progress.

Earn is the Chief Operating Officer of that firm. The 15 specialists are its
desk heads. The operator is the principal. The product's job is to make that
relationship **compound**.

---

## 2. What "compounding" means here — the four flywheels

Most AI features are linear: ask, get an answer, done. Earn is built so value
**accrues**. Four flywheels turn each interaction into leverage on the next:

| Flywheel     | The loop                                                                                                    | What the user feels                                   |
| ------------ | ----------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| **Proof**    | Every approved action writes a `chain_of_trust_records` row → readiness ↑ → unlocks the next stage          | "Nothing I do evaporates. It all lands on my record." |
| **Context**  | Each move emits a `loop_event` → Earn's next-best-action sharpens → the contextual nudge gets more specific | "It knows where I am and what's actually next."       |
| **Routing**  | Each ask routes to a specialist → that specialist's prior outputs become the next ask's context             | "The team remembers. I never re-explain."             |
| **Momentum** | Readiness deltas + streaks + the team's between-session work surface as felt progress                       | "I left, the firm kept working, and I can see it."    |

The thesis in one line: **execution compounds; browsing doesn't.** Earn is
command-first precisely so the default action is a move, not a chat.

---

## 3. A day in the operator's seat (command-first)

The orb is always there — bottom-right, a glance away. The operator taps it.

1. **"What are we moving forward today?"** — the panel opens command-first.
   The contextual next-move is already drawn from live readiness: _"Source is
   62% ready — continue LP & capital targets."_ One tap and they're there.
2. They hit **Find**. Marcus has three on-thesis deals queued from overnight.
   Approve one → it enters the pipeline, a `loop_event` fires, the Source
   readiness ticks up, and the deal is now an input Marcus reuses next time.
3. They hit **Review** on the strongest. The committee runs; Adrian's
   compliance read and Theodore's thesis check are already attached because
   the routing pulled their prior work on this mandate. The verdict logs to
   the Chain of Trust.
4. They hit **Analyze** on the seller's CIM. The diligence brain answers from
   the real documents — and the red flags it surfaces become follow-up
   questions Eleanor can send, and gaps Adrian can track. One analysis, three
   desks fed.
5. They close the orb. Overnight, the task engine watched an LP open the deck
   twice and drafted Eleanor a follow-up — waiting, pre-approved-shaped, for
   tomorrow's first tap.

Nothing in that day was a dead end. Every action **fed another desk and
strengthened the record**. That is the compounding.

---

## 4. The executive team as one compounding org

The 15 specialists are not 15 chatbots — they are **one operating system** with
handoffs. Each desk's output is another desk's input; Earn orchestrates the
relay. The value compounds because work flows _through_ the team, not _around_
it.

| Specialist                            | Desk                    | What they produce                                            | Whose input it becomes                  |
| ------------------------------------- | ----------------------- | ------------------------------------------------------------ | --------------------------------------- |
| **Earn** (Earnest Fundmaker) · COO    | Orchestration           | Routes every ask, holds the mandate, drives the approve loop | Everyone's — the conductor              |
| **Sterling** · Chief of Staff         | Workflows & close plans | The sequenced operating plan, close checklists               | Whoever owns the next step              |
| **Dalia** · Head of Data Operations   | The record              | One decision-ready firm record                               | Every analytical desk                   |
| **Theodore** · Chief Strategy Advisor | Thesis                  | Pressure-tested investment thesis                            | Marcus (sourcing), Sloane (raise story) |
| **Marcus** · Deal Origination         | Pipeline                | On-thesis, scored deals                                      | Adrian (diligence), the committee       |
| **Priya** · Capital Markets           | Counterparties          | Co-invest / lender / structure matches                       | Sloane, Sterling (close)                |
| **Sloane** · Capital Formation        | The raise               | LP target list, allocation map                               | Eleanor (IR), Sterling (close)          |
| **Adrian** · Counsel & Compliance     | The guardrails          | Formation checklist, compliance baseline, diligence clears   | The whole record — keeps it provable    |
| **Eleanor** · Investor Relations      | LP trust                | Letters, updates, the data room cadence                      | Sloane (warm LPs convert)               |
| **Vivian** · Demand Generation        | Top-of-funnel           | Lead engine for portfolio companies                          | Camille                                 |
| **Camille** · Top-of-Funnel           | Qualified leads         | Intent-scored prospects                                      | Vivian, the portfolio                   |
| **Sienna** · Communications           | Narrative               | Brand, deck, press story                                     | Sloane, Eleanor                         |
| **Noah** · Digital Presence           | Reach                   | Site, SEO, digital footprint                                 | Sienna                                  |
| **Jasper** · Private Events           | Rooms                   | Dinners, convenings                                          | Sloane (LP warmth)                      |
| **Felix** · Enablement                | Mastery                 | Guided walkthroughs, in-product teaching                     | The operator — compounds _their_ skill  |

The compounding org-chart insight: **a deal Marcus sources is only worth what
Adrian can clear, what Sloane can fund, and what Eleanor can keep warm.** Earn
makes that relay automatic, and the Chain of Trust makes it provable end to
end.

---

## 5. Enhancements that compound value (the build-out)

Each of these is **intentional** — it earns its place by making a later moment
better, not by adding surface. Ordered as the Earn slices ship.

### 5.1 A front door that remembers

The public orb runs the five-question front door (emerging FM / LP / business
owner / advisor / internal) **once**. Inside the app, the operator is known —
so the panel opens command-first and never re-asks. _Compounds because:_ the
qualification becomes durable context every desk inherits, and the operator
never pays the friction twice.

### 5.2 A contextual next-move that sharpens with readiness

The nudge is drawn from **real** hub readiness + the loop's next-best-action,
not static copy. As readiness rises, the recommendation moves up the lifecycle
on its own. _Compounds because:_ the more the operator executes, the more
precise the guidance — the system is most helpful exactly when there's most at
stake.

### 5.3 The diligence brain that feeds the whole lifecycle

"Ask your documents" is not a one-off Q&A. An analysis of a CIM produces:
red flags Adrian tracks, follow-up questions Eleanor sends, a memo Sloane uses
in the raise, and a verdict logged to the Chain of Trust. _Compounds because:_
one upload pays four desks, and the answer is **provable** (cited to the real
document, scored, on the record).

### 5.4 The task engine — your fundraise runs while you execute

The HubSpot-style trigger layer is the heart of "the firm works while you
sleep." Each trigger drafts a pre-shaped, approve-ready action:

| Trigger (real signal)   | Earn drafts → desk                                       |
| ----------------------- | -------------------------------------------------------- |
| LP opens the deck twice | Follow-up message → Eleanor                              |
| Investor requests docs  | Diligence checklist + data-room grant → Adrian / Eleanor |
| Prospect goes cold      | Reactivation note → Sloane                               |
| Meeting completed       | Notes, next steps, record update → Sterling              |
| New business submitted  | Score the target, request missing info → Marcus          |
| Deal hits Committed     | Open the closing, sequence the steps → Sterling          |

_Compounds because:_ the operator's attention is the scarcest asset — the
engine spends it only on approvals, and every approval feeds the Proof
flywheel. **Honest-data rule:** triggers fire only on real, observed signals;
nothing is invented, and the draft says plainly what it is.

### 5.5 Specialist routing that becomes institutional memory

Real routing (the same `personaFor` map the diligence layer uses) classifies
each ask, streams the "Routing to {specialist}…" moment, and attributes the
answer. _Compounds because:_ routing isn't theater — it selects which brain's
**prior outputs on this mandate** load as context. The tenth time you ask
Sloane about the raise, she's standing on nine prior answers.

### 5.6 Results that persist and fan out — the `/earn` page as the compounding ledger

Every Earn outcome is saved on the `/earn` page **and** fanned out to its home
surface: a drafted LP letter lands in IR, a sourced deal in the pipeline, a
cleared finding on the Chain of Trust. _Compounds because:_ the operator's work
with Earn becomes a **searchable, reusable corpus** — the firm's memory, not a
disappearing chat scroll.

### 5.7 The Chain of Trust as the compounding asset

This is the asset that appreciates. Every approved action across every desk
writes one immutable, provable record. _Compounds because:_ a fund's hardest
sell is _credibility_ — and a tamper-evident ledger of every formation step,
diligence clear, closing, and wire is the credibility, accumulating with every
move. The longer the operator runs on FundExecs OS, the more unassailable their
record.

---

## 6. The trust contract (why the compounding is credible)

Compounding only works if every increment is **real**. The guardrails are not
friction — they are what makes the accumulation worth anything:

- **You decide, the team drafts.** Every mutation comes back through the approve
  loop. Earn never acts unasked.
- **Honest data only.** Every count, roster, and recommendation is from
  Supabase or honestly absent. Nothing fake is ever written, so the record
  never has to be walked back.
- **Money and signatures are recorded, not faked.** Wires and signatures are
  attestations against the operator's real bank and real documents — no money
  moves through FundExecs OS, and the copy says so.
- **Every claim is provable.** Diligence answers cite real documents; Chain of
  Trust rows link to the surface that wrote them.

Credibility that compounds is the moat. The trust contract is what keeps it
real.

---

## 7. How it maps to what's built — and what's next

| Layer                                           | Status                                                | Compounding role                                                               |
| ----------------------------------------------- | ----------------------------------------------------- | ------------------------------------------------------------------------------ |
| Lifecycle hubs (Build · Source · Run · Execute) | Live, tabbed cockpits                                 | The desks where the team's work lands; readiness is the Proof flywheel's gauge |
| The approve loop (`ActionRunner`)               | Live, everywhere                                      | The single chokepoint that turns intent into a provable record                 |
| Chain of Trust                                  | Live; formation, diligence, closings, wires log to it | The appreciating asset                                                         |
| Earn orb + command-first panel                  | **PR #383 (foundation)**                              | The always-on front door; command-first = execution-first                      |
| `/earn` page + rail entry                       | Next slice                                            | The compounding ledger — results persist & fan out                             |
| Real specialist routing                         | Next slice                                            | Routing → institutional memory (Routing flywheel)                              |
| Task engine (triggers)                          | Next slice                                            | "The firm works while you execute" (Momentum flywheel)                         |

---

## 8. The metric of compounding — what the operator feels

The product is working when the operator can _feel_ the curve bend:

- **Readiness rises faster than effort.** Each session advances more than the
  last, because the team carried work between them.
- **Re-explaining goes to zero.** The team remembers the mandate; asks get
  shorter and answers get sharper.
- **The record gets harder to argue with.** The Chain of Trust grows; the next
  LP conversation opens from a stronger position than the last.
- **Decisions, not chores.** The operator's day fills with approvals that
  matter and empties of the busywork the desks absorbed.

That is the whole bet: **a fund that compounds because the firm running it
does.**
