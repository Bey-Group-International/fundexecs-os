// lib/meetings/action-items.server.ts
// Turning a report's action items into tasks on the right people's lists.
//
// Two things were wrong with the version this replaces, and they compounded.
//
// Every task was assigned to whoever ended the meeting. The items say who they
// are for — the prompt asks for exactly that — so the host inherited a list of
// other people's commitments, and the people named were never told.
//
// And the whole batch was fired off with `void` immediately before the
// response returned. On a serverless runtime the invocation can be frozen the
// moment the response is sent, so the inserts that had not finished simply did
// not happen. Nothing logged it, because nothing was waiting to hear.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/supabase/database.types";
import { createTeamTask } from "@/lib/team-tasks";
import { matchDirectoryPerson, type DirectoryPerson } from "@/lib/meetings/directory";
import { actionItemKey, clampTitle, parseActionItem } from "@/lib/meetings/action-items";
import { logId } from "@/lib/log-safe";

type Client = SupabaseClient<Database>;

export interface ActionItemTaskInput {
  orgId: string;
  /** The meeting these came from. Stamped on each task, and how a re-run is spotted. */
  meetingId: string;
  /** Who ran the meeting: the assigner, and the assignee of last resort. */
  hostId: string;
  meetingTitle: string;
  dealId?: string | null;
  /** The meeting's summary, carried onto each task as context. */
  summary?: string;
  items: string[];
  /** The organization's members. Omitted or empty, everything stays with the host. */
  directory?: readonly DirectoryPerson[];
}

export interface ActionItemTaskResult {
  /** Tasks that were written. */
  created: number;
  /** Of those, how many reached somebody other than the host. */
  routed: number;
  /** Items that named an owner the directory could not place, uniquely or at all. */
  unrouted: string[];
  /** Items this meeting had already raised, left alone rather than filed twice. */
  skipped: number;
}

/**
 * Create one task per action item, assigned to whoever the item names.
 *
 * An owner is used only when the directory resolves it to exactly one member —
 * the same unique-or-nothing rule the invitation path uses, for the same
 * reason: a commitment filed against the wrong colleague is worse than one that
 * stayed with the host, because somebody will act on it.
 *
 * Awaited, not fired off. Never throws: `createTeamTask` already swallows its
 * own failures and returns null, and a report must not fail because a task did.
 */
export async function createActionItemTasks(
  supabase: Client,
  input: ActionItemTaskInput,
): Promise<ActionItemTaskResult> {
  const parsed = (input.items ?? [])
    .map(parseActionItem)
    .filter((item) => item.task.trim().length > 0);
  if (parsed.length === 0) return { created: 0, routed: 0, unrouted: [], skipped: 0 };

  // What this meeting has raised before. A report is produced more than once
  // whenever the room retries a lost response or a host regenerates one that
  // read wrong, and filing the same commitment on a colleague's list twice is
  // worse than not filing it at all.
  const already = await raisedActionItems(supabase, input.meetingId);
  const fresh = parsed.filter((item) => !already.has(actionItemKey(item.line)));
  const skipped = parsed.length - fresh.length;
  if (fresh.length === 0) return { created: 0, routed: 0, unrouted: [], skipped };

  const directory = input.directory ?? [];
  const unrouted: string[] = [];

  const results = await Promise.all(
    fresh.map(async (item) => {
      const match = item.owner ? matchDirectoryPerson(item.owner, directory) : undefined;
      if (item.owner && !match) unrouted.push(item.owner);

      const task = await createTeamTask(supabase, {
        organizationId: input.orgId,
        assignedTo: match?.id ?? input.hostId,
        assignedBy: input.hostId,
        // The owner prefix is dropped only once the item has actually reached
        // that person — it is already on their list. An item that fell back to
        // the host keeps it, because "Sarah: send the deck" sitting on the
        // host's list without the name is a commitment with no owner at all.
        title: clampTitle(match ? item.task : item.line),
        description: describe(item.line, input.meetingTitle, match),
        hub: "execute",
        module: "live_meetings",
        priority: "normal",
        // Meetings about a deal produce tasks about that deal.
        dealId: input.dealId ?? null,
        meetingId: input.meetingId,
        // The item verbatim, so a later run can tell it has already been
        // raised without having to reconstruct the title it was given.
        contextSnapshot: { summary: input.summary ?? "", action_item: item.line } as Json,
      });

      return { ok: Boolean(task), routed: Boolean(task && match) };
    }),
  );

  return {
    created: results.filter((r) => r.ok).length,
    routed: results.filter((r) => r.routed).length,
    unrouted,
    skipped,
  };
}

/**
 * The action items this meeting has already turned into tasks.
 *
 * Never throws: failing to read them means the worst case is a duplicate task,
 * and refusing to write the report over it would be far worse. Logged, because
 * a duplicate nobody expected is confusing enough to deserve a trail.
 */
export async function raisedActionItems(supabase: Client, meetingId: string): Promise<Set<string>> {
  const keys = new Set<string>();
  if (!meetingId) return keys;
  try {
    const { data, error } = await supabase
      .from("team_tasks")
      .select("title, context_snapshot")
      .eq("meeting_id", meetingId)
      .limit(500);
    if (error) throw new Error(error.message);

    for (const row of (data ?? []) as Array<{ title: string | null; context_snapshot: unknown }>) {
      const snapshot = row.context_snapshot as { action_item?: unknown } | null;
      const verbatim = typeof snapshot?.action_item === "string" ? snapshot.action_item : "";
      // The title is the fallback for tasks written before the item was kept
      // verbatim; it is the clamped form, so it only matches short items.
      const key = actionItemKey(verbatim || row.title || "");
      if (key) keys.add(key);
    }
  } catch (err) {
    // The id never reaches the format string, and never reaches the log as
    // itself. Two separate problems: a value in the first argument to
    // console.error IS the format string, so a "%s" in it would swallow the
    // next argument; and a newline in it would end the line and have whatever
    // followed read as an entry this process wrote. So the message is a
    // constant and the id goes through an allowlist as an argument.
    console.error(
      "[meetings/action-items] could not read what a meeting already raised",
      { meetingId: logId(meetingId) },
      err,
    );
  }
  return keys;
}

/** What the task says about where it came from. */
function describe(line: string, meetingTitle: string, match: DirectoryPerson | undefined): string {
  const origin = `Auto-created from meeting: ${meetingTitle || "Untitled"}`;
  // The item verbatim, so nothing the report said is lost to the title's
  // length limit or to the owner prefix being stripped off it.
  const verbatim = `Action item: ${line}`;
  return match
    ? `${origin}\n\n${verbatim}\n\nAssigned to you because this action item names you.`
    : `${origin}\n\n${verbatim}`;
}
