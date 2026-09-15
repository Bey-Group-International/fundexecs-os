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
import { clampTitle, parseActionItem } from "@/lib/meetings/action-items";

type Client = SupabaseClient<Database>;

export interface ActionItemTaskInput {
  orgId: string;
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
  if (parsed.length === 0) return { created: 0, routed: 0, unrouted: [] };

  const directory = input.directory ?? [];
  const unrouted: string[] = [];

  const results = await Promise.all(
    parsed.map(async (item) => {
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
        contextSnapshot: (input.summary ?? "") as Json,
      });

      return { ok: Boolean(task), routed: Boolean(task && match) };
    }),
  );

  return {
    created: results.filter((r) => r.ok).length,
    routed: results.filter((r) => r.routed).length,
    unrouted,
  };
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
