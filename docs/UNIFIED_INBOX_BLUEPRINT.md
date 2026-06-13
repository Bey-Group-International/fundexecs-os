# Unified Inbox + In-App Video — Blueprint

> Status: **P1–P3.1 landed + P4 foundation**. Additive throughout: a new
> `/inbox` route over `inbox_items`, ingestion that surfaces Gmail/Slack/call
> conversations as triage items, guarded accept/dismiss, Earn-drafted replies
> sent in-channel (Gmail/Slack) with threading, and the in-app call foundation
> (`live_rooms` + LiveKit token minting + transcript → Meeting Copilot). The
> only behaviour changes outside the inbox are two new send OAuth scopes
> (`gmail.send`, `chat:write`, one-time reconnect) and optional `LIVEKIT_*`
> env (calling is off until set). The Notifications page stays intact and is
> reachable from the Inbox "System" tab.

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

### P2 — Email + Slack ingest & route _(landed)_

- `lib/inbox/ingest.ts` — maps normalized Gmail/Slack/call interactions to
  `inbox_items`, with a deterministic, explainable 0-100 score (recency ·
  channel · relationship · responsiveness) in the `matches.rationale` shape.
  Pure mapping + scoring are unit-tested.
- `ingestSignals` now writes `inbox_items` alongside contacts/interactions on
  every sync (idempotent on `(org_id, channel, external_id)`), reusing the
  email→contact map so items auto-resolve to known contacts.
- `act_on_inbox_item` SECURITY DEFINER RPC + server action: guarded
  pending → accepted/dismissed, with optional deal routing (validated to the
  org). Accept/Dismiss wired into the Inbox UI (optimistic, reverts on
  rejection).
- Deal auto-resolution beyond contact linking is deferred to a follow-up (a
  deal picker / scorer-based routing on accept).

### P3 — Earn-drafted replies + send _(landed)_

- `lib/inbox/draft.ts` — Earn drafts a reply (Claude, chat tier) from the
  conversation + resolved contact onto `inbox_items.draft_reply`. Never-block,
  same contract as `match-judge`.
- `lib/inbox/send.ts` — Gmail `messages.send` + Slack `chat.postMessage`
  primitives, returning a typed `missing_scope` reason so the UI can prompt a
  reconnect.
- `draft_inbox_reply` / `send_inbox_reply` server actions: authorize via an RLS
  read, resolve the channel's connection + token (refresh when expired), send,
  then mark the item `sent`.
- **Net-new OAuth scopes** (the main ask): `gmail.send` added to
  `GOOGLE_SCOPES`, `chat:write` to the Slack user scopes. Existing connections
  must reconnect once to grant them.
- UI: a per-row composer — "Reply" generates Earn's draft, the operator edits
  and sends in-channel.
- External Zoom/Meet calls already land as `channel = 'call'` items via P2
  ingest (no media infra). Email/Slack threading on send (In-Reply-To /
  Gmail `threadId`) is a follow-up — the original `Message-ID` isn't stored
  yet, so replies currently send as a fresh `Re:` message.

### P3.1 — Reply threading _(landed)_

- Gmail ingestion captures `threadId` + the RFC822 `Message-ID`
  (`inbox_items.thread_id` + new `reply_to_message_id`).
- `sendGmailReply` sets `In-Reply-To`/`References` headers and the Gmail
  `threadId`, so replies land in the original conversation.

### P4 — In-app calls (LiveKit) _(foundation landed)_

- `live_rooms` table keyed to org/deal/contact, linked to an inbox `call`
  item. RLS mirrors `inbox_items`.
- `lib/inbox/livekit.ts` — env-guarded, dependency-free HS256 access-token
  minting (unit-tested). With no `LIVEKIT_*` env the feature is off.
- `start_inbox_call` / `join_inbox_call` / `finalize_inbox_call` actions:
  provision a room + `call` inbox item, mint join tokens (authorized via RLS),
  and on wrap-up run the transcript through `runMeetingCopilot` so findings
  land on the linked deal.
- UI: "New call" in the inbox header, a `Join` action on `call` items, and a
  `/inbox/call/[room]` surface with the working close-out (transcript →
  Meeting Copilot) loop.
- **Remaining slice:** the embedded real-time media client
  (`@livekit/components-react` room + egress + live transcription that auto-
  feeds `finalize_inbox_call`). The token + finalize seams are in place.
- **Flag before that slice:** per-minute egress/recording + TURN bandwidth
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
