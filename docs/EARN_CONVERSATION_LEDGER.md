# Earn Conversation Ledger — a native Earn + Executive Team function

> **Decision (locked):** deliver as an evaluation + feature-adoption proposal (this doc → draft
> PR); store conversation logs on the **existing Earn Ledger** (`earn_outcomes`, surfaced at
> `/earn`); and **adopt the capability as a first-class function, not an integration** —
> conversation logging becomes part of what Earn and the Executive Team _do_.
>
> Proprietary-forward: this is the **Earn Conversation Ledger**, an Earn/Executive-Team function.

## Principle: adoption over integration

The point of this work is **not** to wire FundExecs to an external conversation/routing tool. It is
to **adopt that capability into the OS as a native function** — owned, on-brand, on the Chain of
Trust, and free of any third-party dependency or data leaving the platform. We absorb the behavior,
we don't rent it:

- **Zero third-party APIs or keys.** Every function below runs on the OS's own spine (the Earn
  Ledger, the recorder chokepoint, the Action Queue, deterministic text logic, and the existing
  search layer). No external service is in the path, and **nothing requires an API key to work** —
  any LLM or embedding step is an _optional, never-block enhancement_ that degrades to a fully
  functional deterministic default.
- **No vendor in the data path.** Conversation capture, structuring, recall, and routing are native
  OS behavior — not an outbound webhook.
- **Retire the external integration for this purpose.** `lib/integrations/tasklets-ai.ts` is
  superseded for anything conversational; it is removed from the conversation path entirely.
- **Own the record.** The desk's conversations are institutional memory and must live where the
  outcomes do — inside the OS, never in a third party's system of record.

Every feature below is therefore framed as a function the desk _gains_, replacing a dependency it
_sheds_ — and each is fully operable with **no keys configured**.

---

## 0. The shift: from integration to function

Today the desk's intelligence can be routed out to an external layer
(`lib/integrations/tasklets-ai.ts` — a fire-and-forget webhook for HighLevel scheduling). But the
**record of what Earn and the 15 specialists actually said and decided** belongs _inside_ the OS,
on the Earn Ledger, next to the outcomes and credits it already tracks. Conversation logging is not
an integration to bolt on — it is a native function of the executive desk, and the OS already has
the exact spine to host it:

- **The Earn Ledger** (`earn_outcomes`, read by `getEarnLedger`, rendered at `app/(shell)/earn`) —
  the provable record of every move the desk makes.
- **The recorder chokepoint** (`lib/earn/record-outcome.ts → recordApprovedOutcome`) — one place
  that fans an event out to (1) the Chain-of-Trust audit (`trust_events`) and (2) the ledger
  (`earn_outcomes`), with the audit row id linking the two.
- **Earn + the Executive Team** (`lib/ai/earn.ts` streaming chat, the 15-slug roster, the
  Ask-Earn / Earn-dock surfaces) — the conversations to be logged.

The proposal: add a **`recordConversation` sibling** to the recorder and a **`conversation`
outcome kind**, so every Earn/specialist exchange lands on the Earn Ledger as a first-class,
audited entry — the same "draft → provable record" discipline, extended from approved _actions_ to
the _conversations_ that produce them.

---

## 1. What the function absorbs (adoption map)

Rather than integrate the external conversation/routing tooling, the OS **adopts** each of its four
capabilities as a native Earn/Executive-Team function — replacing the dependency outright:

| Capability                                  | Becomes (native function)                                                                          | Built on                                                                  |
| ------------------------------------------- | -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| Capture a conversation thread               | **Conversation Ledger** — every Earn/specialist turn recorded to `earn_outcomes`                   | `lib/ai/earn.ts`, `recordApprovedOutcome` pattern                         |
| Structure it (summary, turns, action items) | **Conversation digest** — a deterministic/Earn-written summary + extracted action items per thread | `lib/ai/earn.ts`, `lib/diligence/memo.ts` (deterministic-compose pattern) |
| Route follow-ups                            | **Action-item → Action Queue** — extracted items become gated `task_runs` proposals                | `lib/agents/executors.ts`, `lib/actions/tasks.ts` (P1-A)                  |
| Recall past context                         | **Conversation recall** — RAG over logged threads                                                  | `knowledge_chunks` + Voyage + `match_knowledge_chunks`                    |

The conversation path becomes fully native and key-free; the external webhook is removed from it.
Any remaining outbound scheduling is a separate concern slated to be brought in-house on the same
adoption-over-integration principle — not a dependency this function carries.

---

## 2. Proposed features

Each: **problem · function · flow · value · monetization · priority.**

### F1 — Conversation Ledger (every desk conversation, on the record)

- **Problem.** Earn and the specialists hold the most consequential conversations on the desk, but
  they evaporate — no durable, searchable, auditable record sits beside the outcomes they drive.
- **Function.** On each Earn/specialist exchange, write one `earn_outcomes` row (kind
  `conversation`) carrying the specialist slug, a short digest, and a link to the full transcript;
  fan a `trust_events` row for the audit (mirroring `recordApprovedOutcome`).
- **Flow.** `app/ask-earn` / Earn dock → `lib/ai/earn.ts` completes a turn → `recordConversation()`
  (new sibling in `lib/earn/record-outcome.ts`) → ledger entry visible at `/earn`, filterable by
  specialist.
- **Value.** **GP/operator:** nothing the desk discussed is lost; **analyst:** searchable history;
  **LP/audit:** decisions traceable to the conversation that formed them.
- **Monetization.** Anchors the paid "executive desk" seat (the ledger is the proof the team
  works); optional retention tiers for transcript history depth.
- **Priority: 5.**

### F2 — Conversation digest + action items

- **Problem.** A logged transcript is noise without the gist and the to-dos.
- **Function.** **Key-free by default:** a deterministic digest (lead/last-turn extraction +
  imperative/commitment detection for action items — pure text logic, no model). An Earn-written
  summary is an _optional_ enhancement that only runs when an AI key is present and **degrades
  silently to the deterministic digest otherwise** (never-block).
- **Flow.** On thread close/idle → deterministic digest written onto the ledger entry; action items
  surfaced.
- **Value.** The ledger reads as decisions + next steps, not raw chat — with or without any key.
- **Monetization.** Free at the deterministic tier; usage-metered only if the optional AI summary
  is enabled.
- **Priority: 4.**

### F3 — Action items → Action Queue (gated)

- **Problem.** Conversations generate commitments that then slip.
- **Function.** Extracted action items become **proposed** `task_runs` routed to the owning
  specialist — propose-only, operator approves (P1-A spine).
- **Flow.** Digest action items → `assignTask` + `runTask` → Action Queue → approval triggers the
  relevant executor.
- **Value.** The desk's conversations turn into tracked, approvable work automatically.
- **Monetization.** Part of the agent-seat value; metered per executed run.
- **Priority: 4.**

### F4 — Conversation recall (RAG over the ledger)

- **Problem.** "What did we decide about X three weeks ago?" is unanswerable today.
- **Function.** **Key-free by default:** recall over logged digests via Postgres full-text /
  trigram search on the ledger (no embeddings, no external model) — answers cite the ledger entry.
  Semantic (vector) recall is an _optional_ upgrade that activates only if an embedding key is
  configured, and the keyword recall remains the always-on baseline.
- **Flow.** Ledger entry → indexed → full-text recall in any surface (optional vector rerank when
  available).
- **Value.** The desk gets institutional memory that works on day one, no keys required.
- **Monetization.** Free keyword recall; premium semantic recall depth / retention window.
- **Priority: 3.**

---

## 3. Implementation sketch (for the follow-up PR)

- **Data model (additive).** Add `conversation` to the `earn_outcomes` kind check constraint
  (`lib/earn/outcomes.ts` `OutcomeKind` + the `earn_outcomes_kind_valid` migration). Optional
  `earn_conversations` table for full transcripts, linked from the ledger entry by id (keeps the
  ledger row light). RLS org-scoped + idempotent, mirroring `sourcing_briefs`/`provider_cache`.
- **Recorder.** `recordConversation()` in `lib/earn/record-outcome.ts` — a non-approval sibling of
  `recordApprovedOutcome`: writes the `trust_events` audit row + the `earn_outcomes` ledger row
  (kind `conversation`), best-effort/never-block, returns the audit id.
- **Capture point.** Hook `lib/ai/earn.ts` (and the specialist invocation paths) to call
  `recordConversation()` on turn/thread completion. No change to the streaming UX.
- **Ledger surface.** `getEarnLedger` already reads `earn_outcomes`; the `/earn` view renders the
  new `conversation` kind with its label/chip (add to `OUTCOME_KINDS` + `outcome-icons`).
- **Key-free recall.** Index the digest text for Postgres full-text / trigram recall — the always-on
  baseline. Vector recall (`knowledge_chunks`) is an optional add-on that only engages when an
  embedding key exists; the function never depends on it.
- **Remove the integration from the conversation path.** `tasklets-ai.ts` is taken out of
  conversation capture/routing entirely; the function carries no external dependency or key.

---

## 4. Guardrails

- **On the record:** every conversation entry writes `trust_events` + `earn_outcomes` (one
  recorder, one discipline).
- **Never-block:** logging is best-effort — a recorder failure never interrupts an Earn chat.
- **Propose-only:** action items become _gated_ Action Queue proposals; nothing auto-executes.
- **RLS-scoped** reads/writes; **additive + idempotent** migrations; **frozen** 15 roster slugs;
  tokens-only UI; proprietary-forward naming (Earn Conversation Ledger).

---

## 5. Positioning

The Earn Ledger already proves what the desk _did_. The Earn Conversation Ledger proves what the
desk _thought_ — every exchange with Earn and the Executive Team, summarized, actioned, and recalled,
on the record beside its outcomes. Conversation memory stops being an external integration and
becomes a native function of the executive desk — **owned end to end, with no third-party API or
key in the path**: the OS remembers, so the operator never has to, and never has to trust anyone
else to.
