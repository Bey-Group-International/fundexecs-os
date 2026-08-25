# Google Calendar sync — scope

Status: **not built**. This document is the decision brief, written 2026-08-25
after the Manage calendar hub (PR #991) surfaced how much of the sync surface is
scaffolding rather than function. No code here; the recommendation is at the end.

## What exists today

The application looks like it syncs calendars. It does not.

|                        Piece                        |                                                                                         Reality                                                                                         |
|-----------------------------------------------------|-----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| `live_meetings.external_calendar_*`                 | Five real columns: `provider`, `event_id`, `sync_enabled`, `sync_status`, `last_error`. Written and read throughout the UI.                                                             |
| `syncMeetingExternal()` (`lib/meetings/service.ts`) | Mints `ext_<uuid>` and writes `sync_status: "synced"`. **Contacts no provider.** Its comment says dispatch "is handled by the integrations layer" — that layer has no calendar adapter. |
| `POST /api/meetings/[id]/sync`                      | Calls the above. Returns success. Nothing left the app.                                                                                                                                 |
| `EXTERNAL_SYNC_STATUS_LABELS`                       | Six user-facing states — Not Connected, Sync Off, Sync Pending, Synced, Sync Failed, Needs Re-Sync — none of which reflect a provider.                                                  |
| `lib/integrations/adapters/`                        | calendly, docusign, gmail, slack, finance, inbox, native-meeting, native-signing. **No calendar adapter.**                                                                              |
| `lib/integrations/catalog.ts`                       | `google_calendar: "Google Calendar"` — a display label with nothing behind it.                                                                                                          |
| `lib/google-oauth.ts`                               | Scopes are `gmail.send` and `contacts.readonly`. **No calendar scope.**                                                                                                                 |

So a host can flag a meeting to sync, click re-sync, and be told "Synced", while
the event exists only in this database. The Manage calendar hub's connection tab
now says so explicitly, gated on a `providerSyncAvailable` flag that flips when
this work lands.

## What has to be built

### 1. OAuth scope — the decision with the longest lead time

`https://www.googleapis.com/auth/calendar.events` is a **restricted** scope.
Adding it means:

- Re-verification of the OAuth app with Google, plus (for restricted scopes at
  any scale) a CASA security assessment. Weeks, not days, and it is a
  prerequisite for external orgs — not something that can trail the code.
- Every org re-consenting. An existing `GOOGLE_REFRESH_TOKEN` does not carry the
  new scope.

There is already a pattern for this in `lib/google-oauth.ts`: the People API
grant uses a **distinct vault key** (`GOOGLE_PEOPLE_REFRESH_TOKEN`) and its own
scope set, precisely so connecting one grant never clobbers or downgrades the
other. Calendar should follow it — `GOOGLE_CALENDAR_REFRESH_TOKEN` with
`GOOGLE_CALENDAR_SCOPES` — rather than widening the Gmail grant. Widening it
would force every org to re-consent to *email* sending in order to get calendar,
and a refused consent would break sending that works today.

### 2. The adapter

`lib/integrations/adapters/google-calendar.ts`, following the shape of
`gmail.ts`: resolve the org credential, act, return a `DispatchResult` that
degrades rather than throws.

Operations, in dependency order:

- **create** — meeting saved with sync on → `events.insert`, store the returned
  id in `external_calendar_event_id`. This is the only one that must exist for
  the feature to mean anything.
- **update** — time, duration, title, attendees change → `events.patch`. Without
  this, PR #987's update notices tell attendees the meeting moved while Google
  still shows the old slot: worse than no sync.
- **delete** — meeting deleted or booking cancelled → `events.delete`.
- **reconcile** — an event deleted in Google leaves a stale `event_id` here;
  a 404 on patch has to fall back to insert, not fail.

### 3. Replacing the stub

`syncMeetingExternal` keeps its signature and its six statuses — they are
already correct as a state machine, only unimplemented. `sync_failed` and
`needs_resync` become reachable for the first time, which means the UI paths
that render them get their first real exercise.

### 4. Two-way (optional, and separately large)

Reading Google events back so externally-booked time blocks FundExecs slots:

- `events.list` with `syncToken` for incremental pulls, or a `watch` channel
  with a push endpoint.
- A renewal job — watch channels expire (max ~7 days), the same operational
  shape as the Gmail-watch renewal that native inbound email would need.
- Conflict rules: what wins when both sides changed. This is a product
  decision, not an implementation detail.
- Mapping pulled events into `busyIntervals()` alongside meetings, bookings, and
  blocks — the one part that is genuinely easy, because that function already
  composes several sources.

## Cost and sequencing

| Phase |                                 Work                                 |                   Blocked by                   |
|-------|----------------------------------------------------------------------|------------------------------------------------|
| 0     | Google verification + CASA for the restricted scope                  | Nothing — **start first**, it gates everything |
| 1     | Separate calendar grant (vault key, scopes, connect flow)            | Phase 0 for external orgs                      |
| 2     | Adapter: create + update + delete + 404 reconcile                    | Phase 1                                        |
| 3     | Replace the `syncMeetingExternal` stub; flip `providerSyncAvailable` | Phase 2                                        |
| 4     | Two-way pull, watch renewal, conflict rules                          | Phase 3                                        |

Phases 1–3 are the useful unit: one-way push makes "Synced" true. Phase 4 is
comparable in size to 1–3 combined and should be justified on its own.

## Recommendation

**Start Phase 0 now and decide the rest later.** The verification lead time is
the only part that cannot be compressed by choosing to work harder, and it costs
nothing to have in flight while the product question settles.

**Do not ship Phase 2 without update and delete.** Create-only sync is actively
worse than none: the event appears in Google, then silently rots every time the
meeting moves or is cancelled — and this app now emails attendees when exactly
that happens, so the two sources would visibly disagree.

**Consider whether the answer is Calendly.** There is already a Calendly adapter
and inbound webhook. If the underlying need is "invitees see my real
availability", the blocked-time work in PR #990 plus the existing booking link
may already cover it without a restricted scope at all.

## Interaction with native inbound email

Both this and native inbound email (`RESEND_WEBHOOK_SECRET` → Gmail watch) need
a Google Cloud Pub/Sub topic and a watch-renewal job. If both are wanted, build
that infrastructure once and share it rather than twice.
