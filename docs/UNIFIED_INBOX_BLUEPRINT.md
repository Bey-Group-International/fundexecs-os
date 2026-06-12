# Unified Inbox + In-App Video — Blueprint

> Status: **proposed**. P1 scaffolding (this commit) is additive and inert —
> a new `/inbox` route + empty-by-default read surface over a new
> `inbox_items` table. No existing surface changes behaviour; the
> Notifications page stays intact and is reachable from the Inbox "System"
> tab.

## Why this exists (the workflow lens)

FundExecs OS is a deal-loop command center (sourcing → allocation →
governance → partnerships → execution) with a verifiable Chain-of-Trust
record per entity. A generic "all my messages in one place" inbox is
commoditized. The **defensible** version turns every inbound message into a
routed, Earn-drafted deal action:

1. **Every message auto-resolves to a deal / contact / CoT layer** — a
   LinkedIn DM, an SMS, and a call transcript all land on the same deal
   timeline. Gmail can't do this; it has no trust graph.
2. **Earn triages and drafts in-channel** — the inbox is a worklist of
   _next best replies_, not a pile of unread. Reuses the Match Inbox
   `pending / accepted / dismissed` + rationale pattern.
3. **Channel-agnostic relationship warmth** — warmth is computed today from
   Gmail/Calendar only; folding in LinkedIn/SMS/Calls makes the score real.
4. **One audit trail** — all comms threaded onto the CoT record extends the
   "evidence-backed trust" promise to conversations.

So: **not a generic email client — a "Relationship Inbox" that turns messages
into routed, Earn-drafted deal actions**, surfaced as a minimal evolution of
the existing Notifications bell rather than new nav weight.

## Decisions locked

| Decision       | Choice                                                                                         |
| -------------- | ---------------------------------------------------------------------------------------------- |
| Core value     | Route messages → deals/CoT + Earn drafts replies                                               |
| Top-nav entry  | Evolve the existing bell into **Inbox** (channel-filter chips; System tab keeps notifications) |
| First channels | Start with already-wired: **Email + Slack + Calendar/Calls** (LinkedIn/SMS = coming soon)      |
| Read vs write  | Triage + **Earn-drafted reply, send via channel API**                                          |
| Live video     | **Embed a CPaaS (LiveKit)** — do not build WebRTC from scratch                                 |
| Video format   | **1:1 / small group calls first**; webinars later                                              |
| Video wedge    | **Earn live + auto deal-routing & Meeting Copilot findings**                                   |

## What already exists (build on, don't duplicate)

- **Integrations** — Gmail, Slack, Google Calendar, Zoom, Meet, Calendly are
  OAuth-wired (`lib/integrations/providers/*`). The catalog
  (`lib/integrations/catalog.ts`) already has a `comingSoon` mechanism —
  LinkedIn/SMS slot in there until wired.
- **Match Inbox** (`lib/queries/match-inbox.ts`) — the triage shape
  (`pending/accepted/dismissed`, `score`, `rationale` jsonb, `acted_at`) that
  `inbox_items` mirrors so the triage UI + calibration are reusable.
- **Meeting Copilot** (`lib/meeting-copilot/orchestrator.ts`) — a 4-agent
  orchestrator that turns a _transcript_ into `meeting_findings`. In-app
  calls feed this directly, deleting the "paste a transcript" step.
- **Earn** — always-present orb/dock (`components/shell/AppShell.tsx`); the
  drafting + live-call surface.
- **Notifications** — bell in rail + topbar with unread badge; becomes the
  Inbox entry, with notifications living under a "System" tab.

## Phasing

### P1 — Relationship Inbox shell _(this commit)_

- `inbox_items` table (mirrors `matches`; RLS = members read own org,
  service_role writes).
- `lib/queries/inbox.ts` read surface (+ pending count), empty-state safe.
- `/inbox` route + `InboxList` with channel-filter chips and a System tab to
  `/notifications`.
- Bell in `AppShell` relabelled **Inbox** → `/inbox`, unread badge retained.

### P2 — Email + Slack ingest & route

- Gmail/Slack sync normalizers write `inbox_items` (in addition to warmth).
- `act_on_inbox_item` server action (accept → route to deal/CoT; dismiss).
- Auto-resolution to `deal_id` / `contact_id` via the signal scorer pattern.

### P3 — Earn-drafted replies + send

- Earn pre-drafts `draft_reply`; user approves → send via Gmail send /
  Slack `chat.postMessage`. Adds send OAuth scopes (the main net-new ask).
- External Zoom/Meet calls land as `channel = 'call'` items (no media infra).

### P4 — In-app calls (LiveKit)

- Server-minted LiveKit room tokens; `live_rooms` keyed to deal/contact.
- A call is an inbox item: `Join` → live (Earn present, streaming
  transcript) → on hangup, transcript → `runMeetingCopilot` →
  `meeting_findings` land back on the thread automatically.
- **Flag before building:** per-minute egress/recording + TURN bandwidth
  cost, and recording-consent/retention (jurisdiction-dependent — matters
  for regulated LP users).

### P5 — Webinars / LP broadcasts

- 1-to-many rooms, registration/attendance, attendance-as-warmth, and
  **CoT-gated access** — the thing Zoom webinars structurally can't do.

## Data model — `inbox_items`

One row per message/conversation surfaced for triage. Channel-agnostic.

| Column                                    | Notes                                                                                     |
| ----------------------------------------- | ----------------------------------------------------------------------------------------- |
| `id`                                      | uuid pk                                                                                   |
| `org_id`                                  | FK organizations, RLS scope                                                               |
| `channel`                                 | `email \| slack \| call \| linkedin \| sms \| webinar`                                    |
| `direction`                               | `inbound \| outbound`                                                                     |
| `external_id`                             | provider message/thread id; `(org_id, channel, external_id)` unique for idempotent ingest |
| `thread_id`                               | groups items into a conversation                                                          |
| `contact_id`                              | soft link → contacts (set null on delete)                                                 |
| `deal_id`                                 | soft link → deals (set null on delete)                                                    |
| `subject` / `preview` / `body`            | display + full text                                                                       |
| `draft_reply`                             | Earn's proposed reply (P3)                                                                |
| `score`                                   | 0–100 priority (scorer, P2)                                                               |
| `status`                                  | `pending \| accepted \| dismissed \| sent \| snoozed`                                     |
| `rationale`                               | jsonb `[{factor, weight, detail}]` — same shape as `matches`                              |
| `occurred_at` / `created_at` / `acted_at` | timestamps                                                                                |
