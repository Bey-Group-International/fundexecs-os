// app/api/meetings/[id]/follow-up/draft/route.ts
// Putting the meeting's follow-up in the inbox instead of putting it in the post.
//
// The sibling route (../route.ts) sends the follow-up: the host's mailbox,
// everyone who was in the room, one press. That is the ONLY outward move in this
// product that works that way. Every other one — a reply, a proposed time, a
// booking confirmation, shared materials — goes through lib/gates, becomes a task,
// and waits for a person unless a mandate has explicitly pre-authorized it.
//
// This route is the follow-up joining them. It writes the draft onto each
// attendee's own inbox thread and stops. Somebody opens the inbox, reads it in
// the context of everything else that person has said, edits it, and sends it
// through the composer — which is `replyToThread`, which is Tier 2, which is
// gated.
//
// NOTHING HERE SENDS, and that is structural rather than careful: this module
// imports no mailer, touches no dispatch, and writes no inbox_messages row. The
// table it writes to has no send path at all. A confirmation dialog on a direct
// send could be auto-confirmed; a row that cannot send cannot be.
import { NextRequest, NextResponse } from "next/server";
import { requireOrgContext } from "@/lib/auth";
import { logId } from "@/lib/log-safe";
import { createServerClient } from "@/lib/supabase/server";
import { normalizeNoteText } from "@/lib/meetings/live-notes";
import { meetingRecipients } from "@/lib/meetings/recipients";
import { loadPresentPeople } from "@/lib/meetings/recipients.server";
import { followUpBody, followUpSubject } from "@/lib/meetings/follow-up";
import { personalizeFollowUp } from "@/lib/meetings/follow-up-greeting";
import { plainFollowUp } from "@/lib/meetings/follow-up-format";
import { loadHost } from "@/lib/meetings/report-roles.server";
import {
  DRAFT_CHANNEL,
  draftMessage,
  planFollowUpDrafts,
  type DraftCandidate,
  type DraftTarget,
} from "@/lib/meetings/follow-up-draft";
import { historyAddresses } from "@/lib/meetings/report-inbox";

export const runtime = "nodejs";

interface DraftRequest {
  /** The draft as the host has it on screen; the stored one is used without it. */
  body?: string;
}

/**
 * How many candidate threads one plan will consider.
 *
 * Bounded for the same reason every read in this feature is: an org with a long
 * history against eight addresses can return hundreds of rows to choose eight
 * threads from. Ordered newest first, so what the ceiling drops is the threads
 * `chooseDraftThread` was never going to pick.
 */
const CANDIDATE_LIMIT = 200;

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const auth = await requireOrgContext();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const supabase = await createServerClient();

  const { data: meeting } = await supabase
    .from("live_meetings")
    .select("id, title, host_id, organization_id, attendees")
    .eq("id", id)
    .is("deleted_at", null)
    .maybeSingle();

  if (!meeting) return NextResponse.json({ error: "Meeting not found" }, { status: 404 });
  // The same right as sending it. The draft goes onto threads the whole
  // organisation can see and read as the host's words about their own meeting —
  // that it is unsent makes it reviewable, not public property.
  if (meeting.host_id !== auth.ctx.userId) {
    return NextResponse.json(
      { error: "Only the meeting host can draft the follow-up." },
      { status: 403 },
    );
  }
  // A meeting held outside any organisation has no inbox to draft into. Falling
  // back to the caller's own org would file one org's follow-up in another's.
  if (!meeting.organization_id || meeting.organization_id !== auth.ctx.orgId) {
    return NextResponse.json(
      { error: "This meeting does not belong to your organisation's inbox." },
      { status: 409 },
    );
  }

  const payload = (await req.json().catch(() => ({}))) as DraftRequest;
  const edited = followUpBody(typeof payload.body === "string" ? payload.body : "");

  const [draft, present, host] = await Promise.all([
    edited
      ? edited
      : supabase
          .from("live_meeting_reports")
          .select("analysis")
          .eq("meeting_id", id)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle()
          .then(({ data: report }) => {
            const analysis = (report?.analysis ?? null) as Record<string, unknown> | null;
            return followUpBody(normalizeNoteText(analysis?.follow_up_draft));
          }),
    loadPresentPeople(supabase, id),
    loadHost(supabase, auth.ctx.userId),
  ]);

  if (!draft) {
    return NextResponse.json(
      { error: "There is no follow-up to draft for this meeting yet." },
      { status: 409 },
    );
  }

  // The invitation AND the room, minus the host: the same audience the send path
  // computes, so drafting and sending cannot disagree about who a follow-up is
  // for.
  const audience = meetingRecipients({
    invited: meeting.attendees,
    present,
    senderEmail: auth.ctx.email,
  });
  const addresses = historyAddresses(audience.recipients);
  if (addresses.length === 0) {
    return NextResponse.json(
      {
        error: "Nobody on this meeting has an email address to draft to.",
        unreachable: audience.unreachable,
      },
      { status: 409 },
    );
  }

  const { data: candidateRows, error: candidateError } = await supabase
    .from("inbox_threads")
    .select("id, channel, status, counterparty_email, last_message_at")
    .eq("organization_id", auth.ctx.orgId)
    // The generated lowercase column, not the raw one: providers store addresses
    // capitalised, and comparing those against a lowercased list finds nothing.
    .in("counterparty_email_lower", addresses)
    // Filtered here as well as in the pure rule. The rule is what decides
    // eligibility; this keeps a decade of Docusign notifications out of the 200
    // rows the rule gets to decide from.
    .eq("channel", DRAFT_CHANNEL)
    .order("last_message_at", { ascending: false, nullsFirst: false })
    .limit(CANDIDATE_LIMIT);

  if (candidateError) {
    return NextResponse.json(
      { error: "The inbox could not be read, so nothing was drafted." },
      { status: 502 },
    );
  }

  const plan = planFollowUpDrafts({
    recipients: audience.recipients,
    unreachable: audience.unreachable,
    threads: (candidateRows ?? []) as unknown as DraftCandidate[],
    subject: followUpSubject(meeting.title),
  });

  let created = 0;
  let failed = 0;
  const threadIds: string[] = [];

  // Sequential on purpose. These are a handful of writes, and running them
  // together would mean two attendees sharing an address — which
  // `planFollowUpDrafts` already prevents — or two presses of the button racing
  // to create the same thread. One at a time, the second press finds the thread
  // the first one made.
  for (const target of plan.targets) {
    const threadId = await resolveThread(supabase, auth.ctx.orgId, auth.ctx.userId, target);
    if (!threadId) {
      failed += 1;
      continue;
    }
    if (!target.threadId) created += 1;

    // Upsert on the primary key: drafting twice from the same report replaces the
    // draft rather than failing, and drafting from a LATER meeting replaces it
    // too — one draft per thread is the whole shape of this, because two is a
    // question the composer cannot answer.
    const { error } = await supabase
      .from("inbox_thread_drafts")
      .upsert(
        {
          thread_id: threadId,
          organization_id: auth.ctx.orgId,
          // This attendee's own copy: greeted by name, never as the host.
          // Without the editor's emphasis marks: the composer shows text as text.
          body: plainFollowUp(
            personalizeFollowUp(draft, target.name, { hostName: host?.full_name ?? null }),
          ),
          source: "meeting_follow_up",
          source_meeting_id: id,
          created_by: auth.ctx.userId,
        } as never,
        { onConflict: "thread_id" },
      );

    if (error) {
      console.error("[/api/meetings/:id/follow-up/draft] draft not written", {
        meetingId: logId(id),
        threadId: logId(threadId),
      }, error.message);
      failed += 1;
      if (!target.threadId) created -= 1;
      continue;
    }
    threadIds.push(threadId);
  }

  // `followup_status` is deliberately untouched. Nothing has been sent, and a
  // meeting whose follow-up is drafted still needs a person — closing the
  // "Follow-Up Needed" badge here would hide exactly the meetings that are one
  // press away from being done.
  return NextResponse.json({
    drafted: threadIds.length,
    created,
    failed,
    total: plan.targets.length,
    unreachable: plan.unreachable,
    threadIds,
    // Said in the response as well as in the UI, because this is the one fact a
    // caller must not get wrong about this route.
    sent: 0,
    message: draftMessage({
      drafted: threadIds.length,
      created,
      failed,
      unreachable: plan.unreachable,
    }),
  });
}

type Client = Awaited<ReturnType<typeof createServerClient>>;

/**
 * The thread this draft goes on, creating one when the plan says to.
 *
 * A created thread is marked read and left with no `last_message_at`, because
 * neither is true: nothing has arrived and nothing has been said. The inbox board
 * is what surfaces it — it puts threads carrying an unsent draft first — rather
 * than this route writing a recency or a priority it would be inventing.
 */
async function resolveThread(
  supabase: Client,
  orgId: string,
  userId: string,
  target: DraftTarget,
): Promise<string | null> {
  if (target.threadId) return target.threadId;
  if (!target.create) return null;

  const { data, error } = await supabase
    .from("inbox_threads")
    .insert({
      organization_id: orgId,
      channel: target.create.channel,
      category: target.create.category,
      subject: target.create.subject,
      counterparty_name: target.create.counterparty_name,
      counterparty_email: target.create.counterparty_email,
      status: "open",
      unread: false,
      created_by: userId,
    } as never)
    .select("id")
    .maybeSingle();

  if (error || !data) {
    console.error(
      "[/api/meetings/:id/follow-up/draft] thread not created",
      error?.message ?? "no row returned",
    );
    return null;
  }
  return (data as { id: string }).id;
}
