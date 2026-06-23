// lib/activity.server.ts — server-only DB aggregator for the activity feed.
//
// Import this only from Server Components or Route Handlers — never from Client
// Components. For pure helpers and types, use lib/activity.ts instead.
import * as React from "react";
import { createServerClient } from "@/lib/supabase/server";
import type { Task, Artifact } from "@/lib/supabase/database.types";
import {
  workflowToEntry,
  artifactToEntry,
  mergeTimeline,
  type ActivityEntry,
} from "@/lib/activity";

// React's per-request `cache` is provided by the Next.js runtime; fall back to
// an identity wrapper outside it (e.g. unit tests) so this module loads anywhere.
const cache: <T extends (...args: never[]) => unknown>(fn: T) => T =
  typeof React.cache === "function" ? React.cache : (fn) => fn;

/**
 * Read the org's recent cross-hub activity: parent workflows newest-first, with
 * their produced artifacts folded in as their own entries. Bounded by `limit`
 * and best-effort — any failure returns `[]`.
 *
 * Wrapped in `cache` so multiple consumers in one RSC render share the read.
 */
export const getActivity = cache(
  async (orgId: string, limit = 40): Promise<ActivityEntry[]> => {
    if (!orgId) return [];
    try {
      const supabase = createServerClient();

      const { data: workflowRows } = await supabase
        .from("tasks")
        .select("*")
        .eq("organization_id", orgId)
        .is("parent_task_id", null)
        .order("created_at", { ascending: false })
        .limit(limit);

      const workflows = (workflowRows ?? []) as Task[];
      const workflowEntries = workflows.map(workflowToEntry);

      const workflowIds = workflows.map((w) => w.id);
      const sessionByWorkflow = new Map<string, string | null>(
        workflows.map((w) => [w.id, w.session_id]),
      );

      let artifactEntries: ActivityEntry[] = [];
      if (workflowIds.length > 0) {
        const { data: artifactRows } = await supabase
          .from("artifacts")
          .select("*")
          .eq("organization_id", orgId)
          .in("workflow_id", workflowIds)
          .order("created_at", { ascending: false })
          .limit(limit);
        const artifacts = (artifactRows ?? []) as Artifact[];
        artifactEntries = artifacts.map((a) =>
          artifactToEntry(a, sessionByWorkflow),
        );
      }

      return mergeTimeline(workflowEntries, artifactEntries, limit);
    } catch {
      return [];
    }
  },
);
