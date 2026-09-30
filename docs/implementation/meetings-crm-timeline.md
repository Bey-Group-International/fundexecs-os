# Meetings → CRM timeline

**Status:** plan, awaiting approval. No code written.

The first slice of "make meetings and inbox feed a CRM": a meeting that finishes
writes itself onto the timeline of the contacts who were in it.

---

## 1. What already exists

This is not a new CRM. Almost all of it is built:

| piece | where | state |
|---|---|---|
| Contacts, stages, owners, scoring | `network_contacts`, `lib/network-*.ts` | works |
| A per-contact timeline | `network_activities`, `app/api/network/contacts/[id]/activities` | works |
| `meeting` as a first-class activity type | migration `20260919140000_network_workspace.sql` | exists |
| `is_system` flag for engine-written entries | same | exists, **unused by meetings** |
| `metadata` jsonb, documented for "message id, duration" | same | exists, **unused by meetings** |
| `live_meetings.related_contact_id` (+ company, fund, deal) | selected in every meetings query, typed everywhere, writable via `PATCH /api/meetings/[id]` | **nothing in the UI sets it; nothing reads it** |
| Who was actually in a meeting | `live_meeting_participants` | works |
| Who was invited | `live_meetings.attendees` — `{name, email?, type?}[]` | works |
| Pure rules for resolving both into addresses | `lib/meetings/recipients.ts` | works, reusable here |
| Meetings → contact timeline | — | **does not exist** |

So today the app hosts the meeting, records who attended, transcribes it,
generates a report and emails the follow-up — and the contact's record shows
nothing unless somebody types "had a meeting" by hand.

The schema anticipated this. `is_system` is documented as "system entries come
from the engine and are not user-editable", and `metadata` as "structured
payload for machine-generated entries (from/to stage, message id, **duration**)".
Nothing has ever written one.

## 2. What this slice adds

When a meeting ends and its report is written, one `network_activities` row per
matched contact:

- `activity_type: "meeting"`, `is_system: true`
- `occurred_at` = the meeting's `started_at` (when it *happened*, per the
  column's own doc — not when this row was written)
- `direction: "internal"` for a meeting with a teammate, `"outbound"` when the
  host convened it, `"inbound"` when it came from a booking link
- `subject` = the meeting title
- `body` = the report's summary, trimmed — not the transcript
- `metadata` = `{ meeting_id, room_code, duration_minutes, attended: bool,
  report_url, source: "live_meeting" }`
- `actor_id` = the host's principal id

And the contact's record gains a "Meetings" section reading those rows back,
each linking to its report.

## 3. Decisions already taken

- **System-flagged, always shown.** `is_system: true`, rendered visually
  distinct from hand-logged entries, never editable. The evidence/inference
  line the CRM code is explicit about is preserved in the data.
- **Exact email match only.** A meeting participant links to a contact only when
  their address equals `network_contacts.email`. No domain guessing, no name
  similarity. An unmatched participant is left unlinked and can be attached by
  hand. A gap is recoverable; a wrong link is silently wrong forever.

## 4. The design

Two modules, split so the rules are pure and testable the way the rest of
`lib/meetings` is:

**`lib/meetings/crm-activity.ts` — pure.**

```ts
export interface MeetingActivityInput {
  meeting: { id, roomCode, title, startedAt, endedAt, hostPrincipalId, source };
  invited: Array<{ name: string; email?: string }>;   // live_meetings.attendees
  attended: Array<{ email?: string }>;                // live_meeting_participants
  contactsByEmail: ReadonlyMap<string, string>;       // lowercased email → contact id
  summary: string | null;
}

/** One row per matched contact, deduped, or [] when nobody matched. */
export function meetingActivities(input: MeetingActivityInput): NewActivity[];
```

Every rule lives here and is exactly assertable:

- emails are lowercased and trimmed before matching; an empty or malformed
  address never matches
- one row per contact even if they appear in both the invite list and the
  participants table, and even if invited twice
- `attended` is a fact about that contact, not the meeting: someone invited who
  never joined gets a row saying so
- the host is never logged against their own contact record
- a meeting with no matched contact produces `[]` — no rows, no partial writes
- `body` is bounded; a 90-minute summary does not go into the timeline whole

**`lib/meetings/crm-activity.server.ts`** — resolves `contactsByEmail` with one
query (`network_contacts` filtered by the meeting's addresses, scoped to the
org), calls the pure function, writes the rows. Never throws: a meeting record
that fails to reach the CRM must not fail the report the meeting actually
needed.

**Hook point:** `app/api/meetings/report/route.ts`, which is where
`status: "ended", ended_at` is set and the report is stored (two call sites in
that file, lines ~56 and ~199). After the report is written, not before — the
summary is part of the entry.

## 5. The real risk: idempotency

**`network_activities` has no unique constraint.** Nothing in the schema stops
the same event being written twice, and the report path can run more than once —
`/report/regenerate` exists, and the ended-and-summarised path has two call
sites.

Without a guard, regenerating a report duplicates every meeting entry on every
attendee's record. That is worse than not having the feature: a CRM that
double-counts meetings is one nobody trusts.

Proposal: a partial unique index on the system-written meeting rows, keyed by
the meeting they describe.

```sql
create unique index if not exists network_activities_meeting_contact_uniq
  on public.network_activities (organization_id, contact_id, (metadata->>'meeting_id'))
  where is_system and activity_type = 'meeting' and metadata ? 'meeting_id';
```

Writes then use `upsert` on that key, so a regenerate **updates** the existing
row (a corrected summary reaches the timeline) rather than adding another. This
is the one part of the plan that touches the schema.

## 6. Consequence worth naming

`lib/network-active.ts` folds `network_activities` into an org-wide feed, and
its comment reads: *"The CRM timeline: notes, calls, and meetings people logged
by hand."* After this change that sentence is false — the feed will carry
machine-written entries too. Either the feed filters `is_system`, or the comment
and the feed's labelling change. I would show them, labelled, and fix the
comment; it is the same information the contact record shows.

## 7. Test plan

Guardable exactly, in the pure module (`crm-activity.test.ts`):

- a participant whose address matches gets exactly one row; one who does not,
  none
- case and whitespace in addresses do not affect matching
- a contact invited twice, or invited *and* present, gets one row
- `attended` is true only for someone `live_meeting_participants` recorded
- the host is not logged against themselves
- no matched contacts → `[]`
- `occurred_at` is the meeting's start, never the write time
- `body` is bounded
- **a near-miss address does not match** — `ana@acme.co` vs `ana@acme.com`, and
  `ana@acme.com` vs `ana@sub.acme.com`. This is the test that holds the "exact
  only" decision in place, and the one that fails if anybody later reaches for
  fuzzy matching.

In the server module, with a recording fake client:

- one query resolves contacts, not one per attendee
- a failed CRM write does not fail the report
- a second run over the same meeting writes no second row (the idempotency
  guard, asserted on the upsert key)

Honest about what a test cannot hold: whether the *right* contact was matched in
production data. Exact email is checkable; whether your contacts' stored
addresses are the ones they take meetings from is not something CI can know.

## 8. Explicitly out of scope

- Inbox → timeline. Next slice, and it needs this matching to prove itself
  first.
- Setting `related_contact_id` from the meeting UI. Worth doing, separate, no
  inference involved.
- Fuzzy or domain matching.
- Backfilling past meetings. The migration adds an index, not rows. A backfill
  is a separate, reversible script once the forward path has run for a while.

## 9. What I need from you

1. **The unique index in §5** — it is the only schema change, and the feature is
   not safe without it. Approve or propose another guard.
2. **The org-wide feed in §6** — show system entries labelled, or filter them
   out?
3. **`direction` for a booking-link meeting** — I have it as `inbound`. Say if
   your convention differs.
