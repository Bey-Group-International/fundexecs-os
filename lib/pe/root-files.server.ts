// lib/pe/root-files.server.ts
// Server-only I/O for the per-org PE root files. Defensive: a missing table,
// missing env or failed read degrades to "no root files" (skills then run on
// labelled default settings) — it never throws into a skill run.

import "server-only";
import { createServiceClient, hasSupabaseServiceEnv } from "@/lib/supabase/server";
import { resolveRootFiles, type ResolvedRootFiles, type RootFileRow } from "./root-files";

/** Skills whose `mandate` input defaults to the organization's stored mandate. */
export const MANDATE_BOUND_SKILLS = new Set(["mandate-screen", "target-screen", "first-look"]);

export async function loadRootFiles(orgId: string): Promise<ResolvedRootFiles> {
  if (!hasSupabaseServiceEnv()) return resolveRootFiles([]);
  try {
    const supabase = createServiceClient();
    const { data } = await supabase.from("org_pe_root_files" as never).select("file_key, content, version").eq("organization_id", orgId);
    return resolveRootFiles((data as RootFileRow[] | null) ?? []);
  } catch {
    return resolveRootFiles([]);
  }
}

/**
 * For a mandate-bound skill whose input carries no `mandate`, fill it from the
 * org's stored mandate. An explicit input always wins; an org with no mandate
 * leaves the input untouched (the schema then rejects it, which is the honest answer).
 */
export async function withOrgMandate(orgId: string, skillId: string, input: unknown): Promise<unknown> {
  if (!MANDATE_BOUND_SKILLS.has(skillId)) return input;
  if (!input || typeof input !== "object" || Array.isArray(input)) return input;
  if ((input as Record<string, unknown>).mandate !== undefined) return input;
  const root = await loadRootFiles(orgId);
  if (!root.found.includes("mandate")) return input;
  return { ...(input as Record<string, unknown>), mandate: root.mandate };
}
