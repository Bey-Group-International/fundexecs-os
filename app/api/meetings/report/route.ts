import { NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";
import Anthropic from "@anthropic-ai/sdk";
import { anthropicClient, LONG_RUN_TIMEOUT_MS } from "@/lib/anthropic-client";
import { persistInstitutionalMeetingRecord } from "@/lib/meetings/service";
import { createActionItemTasks } from "@/lib/meetings/action-items.server";
import { parseActionItem } from "@/lib/meetings/action-items";
import { loadOrgDirectory } from "@/lib/meetings/directory.server";
import { normalizeNoteList, normalizeNoteText } from "@/lib/meetings/live-notes";
import { EMPTY_REPORT, generateMeetingReport } from "@/lib/meetings/report-analysis";
import { mergeTranscripts, restoreTranscript, type StoredLine } from "@/lib/meetings/transcript-restore";
import { meanRowConfidence, qualityPreamble, transcriptForModel, transcriptQuality } from "@/lib/meetings/transcript-quality";
import { readAllTranscriptRows } from "@/lib/meetings/transcript-read";
import { inferStartedAt } from "@/lib/meetings/meeting-span";
import { ONE_WAY_KIND } from "@/lib/meetings/one-way";
import { loadReportRoles } from "@/lib/meetings/report-roles.server";
import { loadPresentPeople } from "@/lib/meetings/recipients.server";
import {
  isFreshReport,
  participantNamesForReport,
  unsummarisedReasonFor,
  type UnsummarisedReason,
} from "@/lib/meetings/report-generation";
import { closeMeeting, writeUnsummarisedReport } from "@/lib/meetings/report-generation.server";
import {
  recordMeetingOnTimelines,
  type MeetingForCrm,
} from "@/lib/meetings/crm-activity.server";

export const runtime = "nodejs";
// The model call runs on the long-run client: LONG_RUN_TIMEOUT_MS with one
// retry, so up to 240s of upstream time, plus the writes after it. The
// platform's default function envelope is shorter than that, and a run cut off
// by the platform surfaced as an opaque 504 to a room that then retried the
// whole thing. The report page's REPORT_WAIT_LIMIT_MS is derived from this
// same 300s assumption, so the two must move together.
export const maxDuration = 300;

const MODEL = process.env.CLAUDE_MODEL ?? "claude-sonnet-4-6";

const client = process.env.ANTHROPIC_API_KEY
  ? anthropicClient(process.env.ANTHROPIC_API_KEY, LONG_RUN_TIMEOUT_MS)
  : null;

type ReportSupabase = Awaited<ReturnType<typeof createServerClient>>;

/**
 * Close a meeting out without a summary.
 *
 * Two things here belong to the meeting, not to the model, so a failed or
 * skipped analysis must not skip them:
 *
 *  - the transcript is kept on a report row, which is where the regenerate
 *    route reads `full_transcript` from; and
 *  - the meeting is marked ended. Until the hourly sweep existed this route
 *    was the ONLY place that ever marked one ended, and
 *    `/api/meetings/upcoming` lists anything that is not — so skipping it
 *    stranded a finished meeting in "Upcoming" forever.
 *
 * Two reasons arrive here and the row says which. `reason` set means the
 * transcript was silent or noise and the model was never asked: a FINISHED
 * report that says "nothing to summarise". `reason` null means the model was
 * asked and failed: a row the regenerate button will try again from. The page
 * and the export read the difference off the analysis blob.
 *
 * Deliberately not doing the rest of the success path: no institutional
 * record and no auto-created tasks. There is nothing to record and no action
 * items to create, and the retry re-runs both.
 */
async function endWithoutAnalysis(
  supabase: ReportSupabase,
  meeting: { id: string; started_at: string | null },
  transcript: string,
  reason: UnsummarisedReason | null,
  crm?: { meeting: MeetingForCrm; actorId: string | null },
  firstJoinedAt: string | null = null,
): Promise<void> {
  const meetingId = meeting.id;
  if (reason) {
    await writeUnsummarisedReport(supabase, { meetingId, transcript, reason });
  } else {
    await supabase.from("live_meeting_reports").insert({
      meeting_id: meetingId,
      summary: "",
      key_points: [] as import("@/lib/supabase/database.types").Json,
      action_items: [] as import("@/lib/supabase/database.types").Json,
      full_transcript: transcript,
      analysis: { ...EMPTY_REPORT } as import("@/lib/supabase/database.types").Json,
    });
  }
  const endedAt = new Date().toISOString();
  await closeMeeting(supabase, { meeting, endedAt, firstJoinedAt });

  // The CRM record of a meeting that happened, even though nothing was
  // summarised. Omitting it would make the contact's timeline quietly
  // incomplete, and an incomplete timeline is what makes relationship scoring
  // wrong. The entry carries no report and is REPLACED, not duplicated, if a
  // regenerate later produces one — both write on the same key.
  if (crm) {
    await recordMeetingOnTimelines(supabase as never, {
      meeting: crm.meeting,
      actorId: crm.actorId,
      endedAt,
      durationMinutes: null,
      report: null,
    });
  }
}

export async function POST(req: Request) {
  try {
    const supabase = await createServerClient();

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const body = await req.json() as {
      meetingId: string;
      title?: string;
      participants?: string[];
      transcript: string;
      duration?: number;
    };

    if (!body.meetingId) {
      return NextResponse.json({ error: "meetingId required" }, { status: 400 });
    }

    // Verify caller is the meeting host
    const { data: meeting } = await supabase
      .from("live_meetings")
      // room_code and attendees are for the CRM timeline entry (the report link
      // and the invite list); they cost nothing on a select that already runs.
      .select("id, host_id, organization_id, deal_id, title, started_at, scheduled_at, kind, room_code, attendees, status")
      .eq("id", body.meetingId)
      .single();

    if (!meeting || meeting.host_id !== user.id) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    // The same press of End, arriving twice.
    //
    // The room posts the transcript and waits on this response for as long as
    // the model takes. A browser that gave up waiting, a reload, or the retry
    // state pressed on a response that was in fact on its way posts the same
    // transcript to a meeting that is already ended with a report already on
    // file — and the second run cost a second model call, wrote a second
    // report row, raised every action item again and re-dated the end. Within
    // the window the existing report IS the answer; past it, a second post is
    // a new version and is treated as one.
    if ((meeting as { status?: string | null }).status === "ended") {
      const latest = await supabase
        .from("live_meeting_reports")
        .select("id, created_at, analysis")
        .eq("meeting_id", body.meetingId)
        .order("created_at", { ascending: false })
        .limit(1)
        .then(
          (res) => (res.data as Array<{ id: string; created_at: string; analysis: unknown }> | null)?.[0] ?? null,
          () => null,
        );
      if (latest && isFreshReport(latest.created_at)) {
        return NextResponse.json({
          reportId: latest.id,
          analysis: latest.analysis ?? { ...EMPTY_REPORT },
          tasks: { created: 0, routed: 0, unrouted: [], skipped: 0 },
          repeated: true,
        });
      }
    }

    // Everything the CRM write needs about this meeting, gathered once because
    // three paths below reach it: the success path, and the two that close a
    // meeting without an analysis.
    const crm = {
      actorId: user.id,
      meeting: {
        id: body.meetingId,
        organizationId: (meeting as { organization_id?: string | null }).organization_id ?? null,
        roomCode: (meeting as { room_code?: string | null }).room_code ?? null,
        title: body.title ?? meeting.title ?? null,
        startedAt: meeting.started_at ?? null,
        scheduledAt: meeting.scheduled_at ?? null,
        attendees: (meeting as { attendees?: unknown }).attendees ?? null,
        hostEmail: user.email ?? null,
      } satisfies MeetingForCrm,
    };

    if (!body.transcript?.trim()) {
      // A ONE-WAY CALL with nothing transcribed is a real and ordinary outcome:
      // this browser has no speech recognition, or nobody said anything it
      // recognised. The audio still exists and the session still has to be
      // closed out — this route is the only thing that ever marks a meeting
      // ended, so refusing here left the call sitting open forever and sent the
      // person to a report page that generated nothing, indefinitely.
      //
      // For a MEETING the refusal stands. A meeting with no transcript at all
      // is a meeting that did not happen or a bug, and either way writing an
      // empty report over it would bury the evidence.
      if ((meeting as { kind?: string | null }).kind === ONE_WAY_KIND) {
        await endWithoutAnalysis(supabase, meeting, "", "silent", crm);
        return NextResponse.json({ ok: true, summarised: false, reason: "silent" });
      }
      return NextResponse.json({ error: "meetingId and transcript required" }, { status: 400 });
    }

    // The transcript on file, not just the one the browser posted.
    //
    // `live_meeting_transcripts` has been written throughout every call this
    // product has ever hosted and read by nothing, anywhere — a backup that was
    // never once restored. The report was built from the host's browser memory
    // alone, so the entire record of a meeting hung on one tab surviving to the
    // end of it: a crash, a reload, a phone call, a closed laptop, and the
    // meeting was gone while the rows that could have rebuilt it sat here.
    //
    // A failure to read is not a failure to report. The posted transcript is
    // still in hand, and answering 500 because the backup was unreachable would
    // lose a meeting we can perfectly well summarise.
    //
    // Paged, because this read is capped. `max_rows = 1000` in
    // supabase/config.toml means an unbounded select returns the first
    // thousand rows in silence, and ordering by `ts` makes those the earliest
    // thousand — so a long meeting was summarised from its opening and not its
    // end. `id` is the tiebreak: rows sharing a timestamp need a total order,
    // or a page boundary landing inside a tie drops a row or repeats one.
    // Who the follow-up is from and who it is to, started now so it overlaps
    // the transcript read below rather than queueing behind it.
    const rolesLookup = loadReportRoles(supabase, {
      meetingId: body.meetingId,
      hostId: user.id,
      hostEmail: user.email ?? null,
      invited: (meeting as { attendees?: unknown }).attendees ?? null,
    });
    // Who was actually in the room, for the participant list. The same read
    // the regenerate route makes, so the two reports of one meeting name the
    // same people: this route used to pass the room's peer list and that one
    // the invite list, and they disagreed about who had been there.
    const presentLookup = loadPresentPeople(supabase, body.meetingId).catch(() => []);

    // When the room opened. `started_at` was never written by the room (its
    // write was a query builder that was never awaited, so never sent), so the
    // earliest attendance row stands in: without it the report page shows no
    // length for a meeting with no recording, and the regenerate route hands
    // the model the scheduled length as if it had been measured. Read in
    // parallel with the transcript; a failure here costs the column, not the
    // report.
    const firstJoinRead = supabase
      .from("live_meeting_participants")
      .select("joined_at")
      .eq("meeting_id", body.meetingId)
      .order("joined_at", { ascending: true })
      .limit(1)
      .then(
        (res) => (res.data as Array<{ joined_at: string | null }> | null)?.[0]?.joined_at ?? null,
        () => null,
      );

    let stored = "";
    let storedRows: StoredLine[] = [];
    try {
      const rows = await readAllTranscriptRows((from, to) =>
        supabase
          .from("live_meeting_transcripts")
          .select("speaker, text, ts, confidence, overlapped")
          .eq("meeting_id", body.meetingId)
          .order("ts", { ascending: true })
          .order("id", { ascending: true })
          .range(from, to),
      );
      storedRows = rows as unknown as StoredLine[];
      if (rows.length) stored = restoreTranscript(storedRows);
    } catch (err) {
      console.warn("[/api/meetings/report] stored transcript unavailable", err);
    }

    // The whole record, NOT capped. The model-context clamp used to be applied
    // here — before the store — so a meeting longer than the budget had the
    // opening of its permanent record cut off: `full_transcript`, the
    // institutional record and every later regenerate all read from what this
    // writes, and none of them can get those words back. The clamp belongs to
    // the model's copy alone, and generateMeetingReport applies it to its own
    // input — which is also exactly how the regenerate route treats the same
    // transcript.
    const transcript = mergeTranscripts(body.transcript, stored);

    // What the model reads, which is not the same thing as what is stored.
    //
    // The record keeps every line the room heard, including the ones the speech
    // engine scored as noise and the ones that were a smart speaker in the room
    // being woken. That is right for a record and wrong for a summariser: handed
    // an hour of recognised noise, a model either apologises — which is the best
    // case, and is luck — or confidently summarises decisions nobody made.
    //
    // So the model's copy has those lines withheld, and is told how many and why,
    // from the engine's own scores on the stored rows. `full_transcript` below is
    // the untouched record.
    const quality = transcriptQuality(transcript, { meanConfidence: meanRowConfidence(storedRows) });
    const note = qualityPreamble(quality);
    const readable = transcriptForModel(transcript);
    const modelTranscript = note ? `${note}\n${readable}` : readable;
    const unsummarised = unsummarisedReasonFor(quality.verdict);
    if (unsummarised) {
      // The id the DATABASE returned, and only when it looks like an id.
      //
      // `body.meetingId` is request text, and a log line built from request text
      // is forgeable: a value carrying a newline writes a second entry of the
      // sender's choosing into the operator's log, which is the one place they go
      // to find out what happened. Reaching this line does imply Postgres matched
      // the id to a row on a uuid column, so a malformed one would already have
      // been refused — but that is a property of the column's type rather than of
      // this code, and a log line is not worth resting on it.
      //
      // Checked rather than stripped, deliberately. Stripping the control
      // characters stops the forged SECOND entry and still leaves whatever
      // printable text came with it sitting inside the line, reading as though it
      // were ours. Rejecting the whole value instead means an operator sees
      // either a real id or the plain fact that it was not one, and never a
      // doctored one — and an id this refuses is never silently mangled into a
      // different meeting's, which would send them looking at the wrong call.
      const rawId = String(meeting.id);
      const loggedId = /^[0-9a-fA-F-]{1,64}$/.test(rawId) ? rawId : "(id not loggable)";
      console.warn(
        `[/api/meetings/report] meeting ${loggedId} transcript is ${quality.verdict}:`
        + ` ${quality.usable} of ${quality.heard} lines usable`
        + ` (${quality.withheldNoise} noise, ${quality.withheldAssistant} assistant)`,
      );

      // Not asked. Handed an hour of recognised noise, the model either
      // apologised — the best case, and luck — or confidently summarised
      // decisions nobody made. The record is kept in full, the meeting is
      // closed, and the report row says there was nothing to summarise, which
      // the page and the export render as exactly that.
      await endWithoutAnalysis(supabase, meeting, transcript, unsummarised, crm, await firstJoinRead);
      return NextResponse.json({ ok: true, summarised: false, reason: unsummarised });
    }

    // The prompt and schema live in lib/meetings/report-analysis so the
    // regenerate path produces the identical shape — the log reads
    // `analysis.decisions`, which exists in no column of its own.
    // A model failure is preserved, then reported — it used to be preserved
    // and then reported as success, which is the bug this shape exists to fix.
    // MeetingRoom navigates to the report page on `res.ok` and only offers its
    // "try again" on a failure, so answering 200 with an empty report sent the
    // host to a blank page with no way back: the log's regenerate action is
    // gated on `hasReport` (`summary.length > 0`), so it was hidden for that
    // row too. Answering 500 puts the room in its retry state, and the retry
    // re-posts the transcript it still holds in memory.
    //
    // A missing API key is NOT a failure and still takes the success path:
    // generateMeetingReport returns the empty report rather than throwing.
    const [roles, firstJoinedAt, present] = await Promise.all([rolesLookup, firstJoinRead, presentLookup]);
    // The end is now; the start is whatever the evidence says. Decided once,
    // here, so the meeting row, the CRM timeline and the institutional record
    // all carry the same span.
    const endedAt = new Date().toISOString();
    const startedAt = inferStartedAt({
      startedAt: meeting.started_at,
      firstJoinedAt,
      endedAt,
      durationSeconds: body.duration ?? null,
    });
    crm.meeting.startedAt = startedAt;

    // Attendance rows, the transcript's own speakers and the host — plus the
    // room's peer list, which survives an attendance write that failed. Never
    // the invite list: see participantNamesForReport.
    const participants = participantNamesForReport({
      host: roles.host,
      present,
      transcript,
      extra: body.participants ?? [],
    });

    let analysis: Record<string, unknown>;
    try {
      analysis = await generateMeetingReport(client, MODEL, {
        title: body.title ?? "Untitled",
        participants,
        transcript: modelTranscript,
        durationSeconds: body.duration ?? null,
        host: roles.host,
        recipients: roles.recipients,
      });
    } catch (err) {
      console.error("[/api/meetings/report] analysis failed", err);
      await endWithoutAnalysis(supabase, meeting, transcript, null, crm, firstJoinedAt);
      throw err;
    }

    // Save to DB
    const { data: report, error } = await supabase
      .from("live_meeting_reports")
      .insert({
        meeting_id: body.meetingId,
        summary: normalizeNoteText(analysis.summary),
        key_points: analysis.key_points as import("@/lib/supabase/database.types").Json,
        action_items: analysis.action_items as import("@/lib/supabase/database.types").Json,
        full_transcript: transcript,
        analysis: analysis as import("@/lib/supabase/database.types").Json,
      })
      .select("id")
      .single();

    if (error) throw error;

    // Three writes that need only the report to exist, and not each other: the
    // meeting closed out, the institutional record, and a task per action
    // item. They ran one after another — five or six round trips the host sat
    // through on the "Generating report…" screen after the model had already
    // answered. Now they overlap and the wait is the slowest of them.
    const actionItems = normalizeNoteList(analysis.action_items);
    const [, , tasks] = await Promise.all([
      supabase
        .from("live_meetings")
        // started_at only when the room never recorded one, and only when
        // there is evidence to record: a recorded start is never overwritten.
        .update({
          status: "ended",
          ended_at: endedAt,
          ...(!meeting.started_at && startedAt ? { started_at: startedAt } : {}),
        })
        .eq("id", body.meetingId),

      persistInstitutionalMeetingRecord(supabase, {
        meeting,
        actorId: user.id,
        participants,
        transcript,
        analysis,
        // When the meeting happened, not when the report ran. Usually moments
        // apart; an hour or more apart whenever this is reached by the room's
        // retry, and a different day whenever a host ends a meeting the next
        // morning.
        occurredAt: startedAt ?? meeting.scheduled_at ?? null,
      }),

      // A task for each action item, on the list of whoever the item names.
      //
      // Awaited, not fired off. This used to be `void Promise.allSettled(...)` on
      // the line before the response: on a serverless runtime the invocation can
      // be frozen the moment the response is sent, so any insert that had not
      // landed simply never did — silently, because nothing was waiting to hear.
      // The inserts run in parallel and cost one round trip.
      raiseActionItemTasks(supabase, {
        meeting,
        meetingId: body.meetingId,
        hostId: user.id,
        title: body.title,
        summary: normalizeNoteText(analysis.summary),
        items: actionItems,
      }),

      // The meeting on the CRM record of everyone in it who is a contact.
      //
      // A fourth sibling rather than a fifth round trip: it needs only the
      // report's content, which is in hand, and none of the other three. It
      // never throws — a timeline entry that cannot be written must not cost the
      // host the report they are waiting on — so its result is not read here.
      recordMeetingOnTimelines(supabase as never, {
        meeting: crm.meeting,
        actorId: crm.actorId,
        endedAt,
        durationMinutes: durationMinutes(body.duration ?? null),
        report: {
          summary: normalizeNoteText(analysis.summary),
          decisions: normalizeNoteList(analysis.decisions),
        },
      }),
    ]);

    return NextResponse.json({ reportId: report.id, analysis, tasks });
  } catch (err) {
    console.error("[/api/meetings/report]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to generate report" },
      { status: 500 },
    );
  }
}

/** The posted duration is seconds; the timeline entry records whole minutes. */
function durationMinutes(seconds: number | null): number | null {
  if (seconds === null || !Number.isFinite(seconds) || seconds <= 0) return null;
  return Math.max(1, Math.round(seconds / 60));
}

type ReportMeeting = {
  organization_id: string | null;
  deal_id: string | null;
  title: string | null;
};

async function raiseActionItemTasks(
  supabase: Awaited<ReturnType<typeof createServerClient>>,
  input: {
    meeting: ReportMeeting;
    meetingId: string;
    hostId: string;
    title?: string;
    summary: string;
    items: string[];
  },
) {
  const none = { created: 0, routed: 0, unrouted: [] as string[], skipped: 0 };
  const orgId = input.meeting.organization_id;
  if (input.items.length === 0 || !orgId) return none;
  // Loaded only when an item actually names somebody — most of the cost of
  // this route is the model call, and there is no reason to add two table
  // reads to a report whose items are all unowned.
  const named = input.items.some((item) => parseActionItem(item).owner);
  return createActionItemTasks(supabase, {
    orgId,
    // Stamped on each task, and how a retry after a lost response is
    // spotted: the same commitment must not reach a colleague twice.
    meetingId: input.meetingId,
    hostId: input.hostId,
    meetingTitle: input.meeting.title ?? input.title ?? "Untitled",
    dealId: input.meeting.deal_id ?? null,
    summary: input.summary,
    items: input.items,
    directory: named ? await loadOrgDirectory(supabase, orgId) : [],
  });
}
