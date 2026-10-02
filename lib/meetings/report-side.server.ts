// lib/meetings/report-side.server.ts
// What the report page's sidebar and action items need beyond the report
// itself: who was in the meeting and in what role, where the follow-up has got
// to, and the tasks the action items became.
//
// A loader of its own rather than more reads inside loadReportPage. That one is
// about getting the document on screen in two waves; these are about acting on
// it, and none of them may cost the reader the report. Every read here fails
// soft to an empty answer.
//
// No `server-only` import, matching the other loaders in this repo.
import type { createServerClient } from "@/lib/supabase/server";
import { logId } from "@/lib/log-safe";
import { loadPresentPeople } from "@/lib/meetings/recipients.server";
import type { PresentPerson } from "@/lib/meetings/recipients";
import { loadHost } from "@/lib/meetings/report-roles.server";
import {
  followUpState,
  reportParticipants,
  type ActionItemTask,
  type FollowUpState,
  type ReportParticipant,
} from "@/lib/meetings/report-participants";

type Client = Awaited<ReturnType<typeof createServerClient>>;

/** As many tasks as one meeting's action items could reasonably have become. */
const TASK_LIMIT = 200;

export interface ReportSideData {
  participants: ReportParticipant[];
  hostName: string | null;
  followUp: FollowUpState;
  tasks: ActionItemTask[];
}

export const EMPTY_SIDE: ReportSideData = {
  participants: [],
  hostName: null,
  followUp: { kind: "none" },
  tasks: [],
};

async function soft<T>(label: string, meetingId: string, run: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await run();
  } catch (err) {
    console.warn("[report-side] read failed", { meetingId: logId(meetingId), label }, err);
    return fallback;
  }
}

export async function loadReportSide(
  supabase: Client,
  input: {
    meetingId: string;
    hostId: string | null;
    invited: unknown;
    hasFollowUp: boolean;
    /**
     * Guests the transcript proves were in the room, from the cue rows the page
     * has already loaded.
     *
     * Passed in rather than read here because the rows are already in hand and
     * a long meeting's transcript is not worth a second paged query. Optional so
     * a caller that has no transcript -- or a test -- gets the attendance table
     * on its own, which is the behaviour this had before.
     */
    spoke?: readonly PresentPerson[];
  },
): Promise<ReportSideData> {
  const { meetingId } = input;

  const [host, present, status, drafted, taskRows] = await Promise.all([
    input.hostId ? loadHost(supabase, input.hostId) : Promise.resolve(null),
    loadPresentPeople(supabase, meetingId).catch(() => []),
    soft("status", meetingId, async () => {
      const { data } = await supabase
        .from("live_meetings")
        .select("followup_status")
        .eq("id", meetingId)
        .maybeSingle();
      return ((data as { followup_status?: string | null } | null)?.followup_status ?? null) as string | null;
    }, null),
    soft("drafts", meetingId, async () => {
      const { data } = await supabase
        .from("inbox_thread_drafts")
        .select("thread_id")
        .eq("source_meeting_id", meetingId)
        .limit(TASK_LIMIT);
      return (data ?? []).length;
    }, 0),
    soft("tasks", meetingId, async () => {
      const { data } = await supabase
        .from("team_tasks")
        .select("id, title, status, due_at, assigned_to, context_snapshot")
        .eq("meeting_id", meetingId)
        .order("created_at", { ascending: true })
        .limit(TASK_LIMIT);
      return (data ?? []) as Array<{
        id: string;
        title: string | null;
        status: string;
        due_at: string | null;
        assigned_to: string | null;
        context_snapshot: unknown;
      }>;
    }, []),
  ]);

  // The assignees' names, for the owner chip on an item that was routed.
  const assigneeIds = [...new Set(taskRows.map((t) => t.assigned_to).filter((id): id is string => Boolean(id)))];
  const names = await soft("assignees", meetingId, async () => {
    if (!assigneeIds.length) return new Map<string, string>();
    const { data } = await supabase.from("principals").select("id, full_name").in("id", assigneeIds);
    return new Map(
      ((data ?? []) as Array<{ id: string; full_name: string | null }>)
        .filter((p) => p.full_name)
        .map((p) => [p.id, p.full_name as string]),
    );
  }, new Map<string, string>());

  const tasks: ActionItemTask[] = taskRows.map((t) => {
    const snapshot = t.context_snapshot as { action_item?: unknown } | null;
    return {
      id: t.id,
      title: t.title,
      status: t.status,
      dueAt: t.due_at,
      assignedTo: t.assigned_to,
      assigneeName: t.assigned_to ? names.get(t.assigned_to) ?? null : null,
      actionItem: typeof snapshot?.action_item === "string" ? snapshot.action_item : null,
    };
  });

  // One room, from both sources. The order is not load-bearing and is not
  // claimed to be: `reportParticipants` reads these into sets, and a spoken
  // guest carries no address, so nothing it adds can outrank an attendance
  // row's directory identity whichever way round they go.
  const inTheRoom = input.spoke?.length ? [...present, ...input.spoke] : present;

  return {
    participants: reportParticipants({
      host: host ? { name: host.full_name, email: host.email } : null,
      invited: input.invited,
      present: inTheRoom,
    }),
    hostName: host?.full_name ?? null,
    followUp: followUpState({
      hasDraft: input.hasFollowUp,
      followupStatus: status,
      draftedThreads: drafted,
    }),
    tasks,
  };
}
