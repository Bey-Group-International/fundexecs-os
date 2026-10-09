// lib/meetings/report-generation.server.ts
// Writing a meeting's report from the transcript the database already holds.
//
// Two callers, one path. The regenerate button and the hourly sweep that
// closes meetings nobody ended both need exactly this: read the rows the call
// wrote, merge them with whatever an earlier report kept, decide whether the
// result is worth a model call, write the row, and close the meeting if it is
// still open. The regenerate route used to be the only copy of that sequence
// and it could not be reached without a session, which is why a meeting whose
// host shut the laptop stayed `active` forever with its transcript sitting in
// a table nothing read.
//
// The end-of-meeting route (app/api/meetings/report) is NOT routed through
// here: it also holds the transcript the browser posted, writes the CRM
// timeline and the institutional record, and answers the room. It shares the
// smaller pieces below — the unsummarised row and the close — so the three
// writers cannot disagree about what an empty report looks like or what
// "ended" means.
//
// No `server-only` import, matching the other loaders in this repo: the
// `.server` suffix is the marker, and the guard would put this beyond a test.
import type Anthropic from "@anthropic-ai/sdk";
import type { Json } from "@/lib/supabase/database.types";
import type { createServerClient } from "@/lib/supabase/server";
import { generateMeetingReport } from "@/lib/meetings/report-analysis";
import { inferStartedAt, meetingDurationSeconds } from "@/lib/meetings/meeting-span";
import { mergeTranscripts, restoreTranscript, type StoredLine } from "@/lib/meetings/transcript-restore";
import { meanRowConfidence, qualityPreamble, transcriptForModel, transcriptQuality } from "@/lib/meetings/transcript-quality";
import { readAllTranscriptRows } from "@/lib/meetings/transcript-read";
import { normalizeNoteList, normalizeNoteText } from "@/lib/meetings/live-notes";
import { createActionItemTasks } from "@/lib/meetings/action-items.server";
import { parseActionItem } from "@/lib/meetings/action-items";
import { loadOrgDirectory } from "@/lib/meetings/directory.server";
import { loadReportRoles } from "@/lib/meetings/report-roles.server";
import { loadPresentPeople } from "@/lib/meetings/recipients.server";
import { CORRECTION_KEY } from "@/lib/meetings/report-versions";
import {
  participantNamesForReport,
  unsummarisedAnalysis,
  unsummarisedReasonFor,
  type UnsummarisedReason,
} from "@/lib/meetings/report-generation";

// Both the cookie-bound client and the service client reach the same tables;
// the loaders this calls are typed on the former, and a structural stand-in
// does not survive supabase-js's generics, so the cast is made once here.
type Client = Awaited<ReturnType<typeof createServerClient>>;

/** The meeting columns a report write needs. */
export interface ReportableMeeting {
  id: string;
  title: string | null;
  host_id: string | null;
  organization_id: string | null;
  deal_id?: string | null;
  attendees: unknown;
  status: string | null;
  started_at: string | null;
  ended_at: string | null;
}

/** Every row the call wrote, oldest first, or none when the read failed. */
export async function readStoredTranscriptRows(supabase: Client, meetingId: string): Promise<StoredLine[]> {
  try {
    const rows = await readAllTranscriptRows((from, to) =>
      supabase
        .from("live_meeting_transcripts")
        .select("speaker, text, ts, confidence, overlapped")
        .eq("meeting_id", meetingId)
        .order("ts", { ascending: true })
        .order("id", { ascending: true })
        .range(from, to),
    );
    return rows as unknown as StoredLine[];
  } catch (err) {
    console.warn("[report-generation] stored transcript unavailable", err);
    return [];
  }
}

/**
 * A report row that says, on purpose, that there was nothing to summarise.
 *
 * Written instead of asking the model about silence or noise. It is a
 * FINISHED report: the page renders it as one (with the transcript, if any,
 * behind it), the export says why the summary is missing, and the log offers
 * a regenerate only when there is a transcript to try again from.
 */
export async function writeUnsummarisedReport(
  supabase: Client,
  input: { meetingId: string; transcript: string; reason: UnsummarisedReason },
): Promise<void> {
  const { error } = await supabase.from("live_meeting_reports").insert({
    meeting_id: input.meetingId,
    summary: "",
    key_points: [] as Json,
    action_items: [] as Json,
    full_transcript: input.transcript,
    analysis: unsummarisedAnalysis(input.reason) as Json,
  });
  if (error) throw new Error(error.message);
}

/**
 * Mark a meeting over.
 *
 * `started_at` is filled in only when the room never recorded one and there
 * is evidence to record: a recorded start is never overwritten, and a meeting
 * nobody joined keeps no start at all rather than an invented one.
 */
export async function closeMeeting(
  supabase: Client,
  input: {
    meeting: Pick<ReportableMeeting, "id" | "started_at">;
    endedAt: string;
    firstJoinedAt?: string | null;
    firstSpokenAt?: string | null;
  },
): Promise<{ endedAt: string; startedAt: string | null }> {
  const startedAt = inferStartedAt({
    startedAt: input.meeting.started_at,
    firstJoinedAt: input.firstJoinedAt,
    firstSpokenAt: input.firstSpokenAt,
    endedAt: input.endedAt,
  });
  const { error } = await supabase
    .from("live_meetings")
    .update({
      status: "ended",
      ended_at: input.endedAt,
      ...(!input.meeting.started_at && startedAt ? { started_at: startedAt } : {}),
    })
    .eq("id", input.meeting.id);
  if (error) console.error("[report-generation] could not close meeting", error.message);
  return { endedAt: input.endedAt, startedAt };
}

/** The earliest attendance row, for a start the room never wrote. Null on any failure. */
async function firstJoinAt(supabase: Client, meetingId: string): Promise<string | null> {
  try {
    const { data } = await supabase
      .from("live_meeting_participants")
      .select("joined_at")
      .eq("meeting_id", meetingId)
      .order("joined_at", { ascending: true })
      .limit(1);
    return (data as Array<{ joined_at: string | null }> | null)?.[0]?.joined_at ?? null;
  } catch {
    return null;
  }
}

export interface StoredReportInput {
  meeting: ReportableMeeting;
  /** The host's address from the session, when there is one. The directory stands in otherwise. */
  hostEmail: string | null;
  client: Anthropic | null;
  model: string;
  correction?: string | null;
  /**
   * Runs just before the model is asked — the credit gate, for the route that
   * has one. A refusal ends the run with nothing written. Placed here rather
   * than at the route so a transcript not worth summarising is never charged.
   */
  beforeModel?: () => Promise<{ ok: true } | { ok: false; status: number; error: string }>;
  /** When the meeting is taken to have ended, for a meeting still open. Defaults to now. */
  endedAt?: string;
  now?: Date;
}

export type StoredReportOutcome =
  /** Neither a report row's transcript nor any stored rows: nothing to read. */
  | { kind: "no_transcript" }
  /** `beforeModel` said no. */
  | { kind: "refused"; status: number; error: string }
  /**
   * Silent or noise-only. `written` says whether an unsummarised row was
   * filed: it is not when a real summary already exists, because replacing a
   * readable report with a blank one is the thing a regenerate must never do.
   */
  | { kind: "unsummarised"; reason: UnsummarisedReason; written: boolean; transcript: string }
  /** The model answered with nothing; nothing was written. */
  | { kind: "empty" }
  | { kind: "save_failed"; error: string }
  | {
      kind: "written";
      saved: { summary: string | null; key_points: unknown; action_items: unknown; analysis: Record<string, unknown> | null };
      analysis: Record<string, unknown>;
      transcript: string;
      /** The meeting row after this run: closed here, or already closed. */
      meeting: { status: "ended"; ended_at: string | null; started_at: string | null };
    };

/**
 * Write a fresh report from everything on file, and close the meeting if it
 * is still open.
 *
 * Appends rather than overwrites, as every report writer does: the newest row
 * is the report, the older ones stay readable as versions. A model failure is
 * thrown to the caller, which knows how to answer its own request.
 */
export async function generateReportFromStoredTranscript(
  supabase: Client,
  input: StoredReportInput,
): Promise<StoredReportOutcome> {
  const { meeting } = input;
  const now = input.now ?? new Date();

  // Newest report first — the transcript to work from is the one the latest
  // report was built on, not whichever row the database happens to return.
  const existingRead = supabase
    .from("live_meeting_reports")
    .select("id, full_transcript, summary, analysis")
    .eq("meeting_id", meeting.id)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  // Who ran it and who it is for, and who was actually in the room: the two
  // reads the prompt is addressed from. The attendance read is made once here
  // and handed to both consumers rather than each loading its own copy.
  const rolesRead = meeting.host_id
    ? loadReportRoles(supabase, {
        meetingId: meeting.id,
        hostId: meeting.host_id,
        hostEmail: input.hostEmail,
        invited: meeting.attendees,
      })
    : Promise.resolve({ host: null, recipients: [] });
  const presentRead = loadPresentPeople(supabase, meeting.id).catch(() => []);

  const [{ data: existing }, storedRows, roles, present] = await Promise.all([
    existingRead,
    readStoredTranscriptRows(supabase, meeting.id),
    rolesRead,
    presentRead,
  ]);

  const stored = storedRows.length ? restoreTranscript(storedRows) : "";
  // The report row's copy and the rows the call wrote: neither is a superset
  // of the other, so the better of the two is taken line by line.
  const transcript = mergeTranscripts(((existing?.full_transcript as string | null) ?? "").trim(), stored).trim();
  if (!transcript) return { kind: "no_transcript" };

  const open = meeting.status !== "ended";
  const endedAt = input.endedAt ?? now.toISOString();
  const firstSpokenAt = storedRows[0]?.ts ?? null;
  // Only needed to fill a start the room never wrote on a meeting being
  // closed here; a meeting already ended keeps whatever it has.
  const firstJoined = open && !meeting.started_at ? await firstJoinAt(supabase, meeting.id) : null;
  const close = () =>
    closeMeeting(supabase, { meeting, endedAt, firstJoinedAt: firstJoined, firstSpokenAt });

  // What the model reads is not the record: noise and voice-assistant orders
  // are withheld from its copy and it is told how many. Below that, nothing is
  // asked at all.
  const quality = transcriptQuality(transcript, { meanConfidence: meanRowConfidence(storedRows) });
  const reason = unsummarisedReasonFor(quality.verdict);
  if (reason) {
    const hasSummary = Boolean(normalizeNoteText(existing?.summary));
    if (!hasSummary) {
      await writeUnsummarisedReport(supabase, { meetingId: meeting.id, transcript, reason });
      if (open) await close();
    }
    return { kind: "unsummarised", reason, written: !hasSummary, transcript };
  }

  if (input.beforeModel) {
    const gate = await input.beforeModel();
    if (!gate.ok) return { kind: "refused", status: gate.status, error: gate.error };
  }

  const note = qualityPreamble(quality);
  const readable = transcriptForModel(transcript);
  const modelTranscript = note ? `${note}\n${readable}` : readable;
  const correction = input.correction || null;
  const previousAnalysis = (existing?.analysis ?? null) as Record<string, unknown> | null;

  let analysis = await generateMeetingReport(input.client, input.model, {
    title: meeting.title ?? "Untitled",
    participants: participantNamesForReport({ host: roles.host, present, transcript }),
    transcript: modelTranscript,
    // The span the meeting actually ran, or nothing. For a meeting being closed
    // here that is up to this moment; the booked length is never handed over.
    durationSeconds: meetingDurationSeconds({
      startedAt: meeting.started_at ?? firstJoined ?? firstSpokenAt,
      endedAt: meeting.ended_at ?? endedAt,
    }),
    host: roles.host,
    recipients: roles.recipients,
    correction,
    previous: correction
      ? {
          summary: (existing?.summary as string | null) ?? null,
          followUp: normalizeNoteText(previousAnalysis?.follow_up_draft),
        }
      : null,
  });

  if (!normalizeNoteText(analysis.summary)) return { kind: "empty" };

  // Kept with the version it produced, so the history can say why it exists —
  // and dropped when there was none, so a plain re-read never inherits one.
  if (correction) analysis = { ...analysis, [CORRECTION_KEY]: correction };

  const { data: saved, error } = await supabase
    .from("live_meeting_reports")
    .insert({
      meeting_id: meeting.id,
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

  if (error || !saved) return { kind: "save_failed", error: error?.message ?? "insert returned nothing" };

  const actionItems = normalizeNoteList(analysis.action_items);
  const raiseTasks = async () => {
    if (actionItems.length === 0 || !meeting.organization_id || !meeting.host_id) return;
    const named = actionItems.some((item) => parseActionItem(item).owner);
    await createActionItemTasks(supabase, {
      orgId: meeting.organization_id,
      meetingId: meeting.id,
      hostId: meeting.host_id,
      meetingTitle: meeting.title ?? "Untitled",
      dealId: meeting.deal_id ?? null,
      summary: normalizeNoteText(analysis.summary),
      items: actionItems,
      directory: named ? await loadOrgDirectory(supabase, meeting.organization_id) : [],
    });
  };

  // Three writes that need only the new report, not each other: the meeting
  // closed (when it was open), the corrected action items raised as tasks,
  // and the list's follow-up badge moved with the report it now describes.
  const [closed, , { error: statusError }] = await Promise.all([
    open ? close() : Promise.resolve({ endedAt: meeting.ended_at, startedAt: meeting.started_at }),
    raiseTasks(),
    supabase
      .from("live_meetings")
      .update({
        followup_status: normalizeNoteText(analysis.follow_up_draft) ? "draft" : "not_started",
      } as never)
      .eq("id", meeting.id),
  ]);
  if (statusError) {
    console.error("[report-generation] follow-up status not updated", statusError.message);
  }

  return {
    kind: "written",
    saved: {
      summary: (saved.summary as string | null) ?? null,
      key_points: saved.key_points,
      action_items: saved.action_items,
      analysis: (saved.analysis ?? null) as Record<string, unknown> | null,
    },
    analysis,
    transcript,
    meeting: { status: "ended", ended_at: closed.endedAt ?? null, started_at: closed.startedAt ?? null },
  };
}
