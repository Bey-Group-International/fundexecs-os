import { NextResponse } from "next/server";
import { requireOrgContext } from "@/lib/auth";
import { createServerClient } from "@/lib/supabase/server";
import { anthropicClient, LONG_RUN_TIMEOUT_MS } from "@/lib/anthropic-client";
import { CONVERSATIONAL_COST, gateConversationalSpend } from "@/lib/conversational-gate";
import { generateMeetingReport } from "@/lib/meetings/report-analysis";
import { meetingDurationSeconds } from "@/lib/meetings/meeting-span";
import { mergeTranscripts, restoreTranscript, type StoredLine } from "@/lib/meetings/transcript-restore";
import { meanRowConfidence, qualityPreamble, transcriptForModel, transcriptQuality } from "@/lib/meetings/transcript-quality";
import { readAllTranscriptRows } from "@/lib/meetings/transcript-read";
import { normalizeNoteList, normalizeNoteText } from "@/lib/meetings/live-notes";
import { toLogEntry } from "@/lib/meetings/meeting-log";
import { createActionItemTasks } from "@/lib/meetings/action-items.server";
import { parseActionItem } from "@/lib/meetings/action-items";
import { loadOrgDirectory } from "@/lib/meetings/directory.server";
import { loadReportRoles } from "@/lib/meetings/report-roles.server";
import { CORRECTION_KEY, cleanCorrection } from "@/lib/meetings/report-versions";
import type { Json } from "@/lib/supabase/database.types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MODEL = process.env.CLAUDE_MODEL ?? "claude-sonnet-4-6";

const client = process.env.ANTHROPIC_API_KEY
  ? anthropicClient(process.env.ANTHROPIC_API_KEY, LONG_RUN_TIMEOUT_MS)
  : null;

/**
 * `POST /api/meetings/:id/report/regenerate`
 *
 * Re-read a meeting's own transcript and write a fresh report from it.
 *
 * The transcript is never sent by the caller — it is read from the report
 * already on file. That is the whole point: the feature this replaces asked a
 * member to paste a transcript by hand to get an analysis of a meeting the app
 * had already recorded and already analysed.
 *
 * **Appends rather than overwrites.** A new `live_meeting_reports` row is
 * inserted, exactly as the end-of-meeting route does, so the previous report
 * survives. The log embeds reports ordered `created_at desc` limit 1, so it
 * shows the new one immediately while the old one stays readable in the table.
 * Nothing a colleague may have relied on is destroyed, which is why this needs
 * no "are you sure" — there is nothing to lose.
 *
 * Host only, mirroring `/api/meetings/report`: the report is a shared record,
 * and rewriting what a meeting decided belongs to the person who ran it.
 *
 * **Takes a correction.** `{ correction: "The follow-up is to Jane, not me" }`
 * is handed to the model as overriding the transcript, alongside the version it
 * corrects, and is kept on the new row so the history can say why it exists.
 * Without one this is the plain re-read it always was. Regenerating blind is a
 * coin toss on a report that read wrong for a reason the model cannot see; the
 * host knows the reason and now has somewhere to say it.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const auth = await requireOrgContext();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const payload = (await req.json().catch(() => ({}))) as { correction?: unknown };
  const correction = cleanCorrection(payload?.correction);

  const supabase = await createServerClient();

  const { data: meeting } = await supabase
    .from("live_meetings")
    .select("id, room_code, title, host_id, organization_id, attendees, created_at, started_at, ended_at, scheduled_at, duration_minutes, status, is_draft")
    .eq("id", id)
    .is("deleted_at", null)
    .maybeSingle();

  if (!meeting) return NextResponse.json({ error: "Meeting not found" }, { status: 404 });
  if (meeting.host_id !== auth.ctx.userId) {
    return NextResponse.json({ error: "Only the meeting host can regenerate the report" }, { status: 403 });
  }

  // Newest report first — the transcript to work from is the one the latest
  // report was built on, not whichever row the database happens to return.
  const existingRead = supabase
    .from("live_meeting_reports")
    .select("id, full_transcript, summary, analysis")
    .eq("meeting_id", id)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  // The report row's copy, and the line-by-line record the call itself wrote.
  //
  // They are not the same thing and either can be the fuller one. The report
  // holds whatever the host's browser had in memory when they pressed End —
  // which misses anything said after their last flush, and misses everything if
  // that tab had reloaded mid-call. The rows miss anything a participant failed
  // to write. Regenerating is the moment to take the better of the two: it is
  // the action a host reaches for precisely because the first report read
  // wrong.
  //
  // Paged: an unbounded select stops at `max_rows` (1000) without saying so,
  // and ordered by `ts` that silently discards the END of a long meeting — the
  // part a host is regenerating the report to get right. `id` gives rows that
  // share a timestamp a total order, so a page boundary cannot fall inside a
  // tie and lose or repeat one.
  //
  // Both read at once: neither depends on the other, and the paged read is
  // several round trips on its own for a long meeting.
  const storedRead = readAllTranscriptRows((from, to) =>
    supabase
      .from("live_meeting_transcripts")
      .select("speaker, text, ts, confidence, overlapped")
      .eq("meeting_id", id)
      .order("ts", { ascending: true })
      .order("id", { ascending: true })
      .range(from, to),
  )
    .then((rows) => rows as unknown as StoredLine[])
    .catch((err) => {
      console.warn("[regenerate] stored transcript unavailable", err);
      return [] as StoredLine[];
    });
  // Who the follow-up is from and to. The attendee list alone left the host
  // out entirely, so the model was writing an email with no idea who sent it.
  const rolesRead = loadReportRoles(supabase, {
    meetingId: id,
    hostId: auth.ctx.userId,
    hostEmail: auth.ctx.email || null,
    invited: meeting.attendees,
  });
  const [{ data: existing }, storedRows, roles] = await Promise.all([existingRead, storedRead, rolesRead]);
  const stored = storedRows.length ? restoreTranscript(storedRows) : "";

  const transcript = mergeTranscripts((existing?.full_transcript ?? "").trim(), stored).trim();
  if (!transcript) {
    // Nothing to re-read. Said plainly, because "regenerate" on a meeting that
    // was never transcribed would otherwise look like a silent failure.
    return NextResponse.json(
      { error: "This meeting has no transcript on file, so there is nothing to analyse." },
      { status: 409 },
    );
  }

  const gate = await gateConversationalSpend(
    auth.ctx.orgId,
    CONVERSATIONAL_COST.meetingAnalyze,
    "meeting_analyze",
  );
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });

  const attendees = Array.isArray(meeting.attendees) ? meeting.attendees : [];
  const participants = attendees
    .map((a) => {
      if (!a || typeof a !== "object" || Array.isArray(a)) return "";
      const rec = a as Record<string, unknown>;
      const name = typeof rec.name === "string" ? rec.name.trim() : "";
      const email = typeof rec.email === "string" ? rec.email.trim() : "";
      return name || email;
    })
    .filter(Boolean);
  const hostName = roles.host?.name ?? "";
  if (hostName && !participants.some((p) => p.toLowerCase() === hostName.toLowerCase())) {
    participants.unshift(hostName);
  }

  // The model's copy, which is not the record. Lines the speech engine scored as
  // noise and lines that were a voice assistant being woken are withheld from it,
  // and it is told how many and why. The transcript stored below is untouched.
  //
  // A regenerate cannot rescue a transcript recorded before the engine's score
  // was kept: there is no note on any of those lines to withhold them by, and no
  // way to tell a hallucinated sentence from a real one after the fact. Wake
  // words still go, because text alone establishes those.
  const quality = transcriptQuality(transcript, { meanConfidence: meanRowConfidence(storedRows) });
  const note = qualityPreamble(quality);
  const readable = transcriptForModel(transcript);
  const modelTranscript = note ? `${note}\n${readable}` : readable;

  const previousAnalysis = (existing?.analysis ?? null) as Record<string, unknown> | null;
  let analysis: Record<string, unknown>;
  try {
    analysis = await generateMeetingReport(client, MODEL, {
      title: meeting.title ?? "Untitled",
      participants,
      transcript: modelTranscript,
      // The span the meeting actually ran, or nothing. `duration_minutes` is
      // the BOOKED length: handing it over as the duration had the model
      // reasoning about a 30-minute call that had in fact run for an hour.
      durationSeconds: meetingDurationSeconds({ startedAt: meeting.started_at, endedAt: meeting.ended_at }),
      host: roles.host,
      recipients: roles.recipients,
      correction: correction || null,
      previous: correction
        ? {
            summary: existing?.summary ?? null,
            followUp: normalizeNoteText(previousAnalysis?.follow_up_draft),
          }
        : null,
    });
  } catch (err) {
    console.error("[/api/meetings/:id/report/regenerate]", err);
    return NextResponse.json({ error: "Could not analyse the transcript. Try again." }, { status: 502 });
  }

  if (!normalizeNoteText(analysis.summary)) {
    // An empty report would replace a real one in the log with nothing. Refuse
    // rather than append it: the existing report stays the newest, and the host
    // is told the run produced nothing instead of watching their report vanish.
    return NextResponse.json(
      { error: "The analysis came back empty, so the existing report was left in place." },
      { status: 502 },
    );
  }

  // Kept with the version it produced, so the history can say why it exists —
  // and dropped when there was none, so a plain re-read never inherits one.
  if (correction) analysis = { ...analysis, [CORRECTION_KEY]: correction };

  const { data: saved, error } = await supabase
    .from("live_meeting_reports")
    .insert({
      meeting_id: id,
      summary: normalizeNoteText(analysis.summary),
      key_points: normalizeNoteList(analysis.key_points) as Json,
      action_items: normalizeNoteList(analysis.action_items) as Json,
      // Carried forward unchanged: the transcript is the record of what was
      // said, and a regeneration reinterprets it rather than replacing it.
      full_transcript: transcript,
      analysis: analysis as Json,
    })
    .select("summary, key_points, action_items, analysis")
    .single();

  if (error || !saved) {
    console.error("[/api/meetings/:id/report/regenerate] insert failed", error);
    return NextResponse.json({ error: "Could not save the new report." }, { status: 500 });
  }

  // Two writes that need only the new report, not each other: the corrected
  // action items raised as tasks, and the list's follow-up status. They ran
  // one after the other; now the host waits for the slower of the two.
  //
  // A host regenerates because the first report read wrong. The corrected
  // action items used to go nowhere at all — the new report said Sarah owed
  // something and nothing ever told Sarah. Raising them is only safe because
  // createActionItemTasks now skips what this meeting has already raised, so
  // the items that did not change are left alone rather than filed twice.
  const actionItems = normalizeNoteList(analysis.action_items);
  const raiseTasks = async () => {
    if (actionItems.length === 0 || !meeting.organization_id) return;
    const named = actionItems.some((item) => parseActionItem(item).owner);
    await createActionItemTasks(supabase, {
      orgId: meeting.organization_id,
      meetingId: id,
      hostId: auth.ctx.userId,
      meetingTitle: meeting.title ?? "Untitled",
      summary: normalizeNoteText(analysis.summary),
      items: actionItems,
      directory: named ? await loadOrgDirectory(supabase, meeting.organization_id) : [],
    });
  };

  // The meetings list reads followup_status and shows "Follow-Up Needed" off
  // it. A regeneration that turns a report with no follow-up into one that has
  // a draft — or the reverse — has to move that with it, or the list keeps
  // describing the report the host just replaced.
  const [, { error: statusError }] = await Promise.all([
    raiseTasks(),
    supabase
      .from("live_meetings")
      .update({
        followup_status: normalizeNoteText(analysis.follow_up_draft) ? "draft" : "not_started",
      } as never)
      .eq("id", id),
  ]);
  if (statusError) {
    console.error("[/api/meetings/:id/report/regenerate] follow-up status not updated", statusError.message);
  }

  // Hand back the same shape the log renders, so the row updates in place
  // rather than the page having to reload to show what just changed.
  return NextResponse.json({
    entry: toLogEntry(
      {
        id: meeting.id,
        room_code: meeting.room_code,
        title: meeting.title,
        created_at: meeting.created_at,
        started_at: meeting.started_at,
        ended_at: meeting.ended_at,
        scheduled_at: meeting.scheduled_at,
        duration_minutes: meeting.duration_minutes,
        status: meeting.status,
        attendees: meeting.attendees,
      },
      {
        summary: saved.summary,
        key_points: saved.key_points,
        action_items: saved.action_items,
        // `analysis` comes back typed as Json (which includes scalars); the log
        // wants the object form it was written as.
        analysis: (saved.analysis ?? null) as Record<string, unknown> | null,
        // The row just written carries the same transcript this route read to
        // write it — the 409 above guarantees it was non-empty. Saying so keeps
        // the regenerate button on the row it replaces; the generated column
        // says the same thing on the next load.
        has_transcript: true,
      },
      true,
      // attended AND isHost. Only the host reaches this line, and the log gates
      // the regenerate button on `isHost` — omitting it defaulted the returned
      // entry to false, so the button disappeared the first time it was used.
      true,
    ),
  });
}
