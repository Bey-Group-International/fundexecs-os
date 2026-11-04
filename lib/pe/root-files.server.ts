// lib/pe/root-files.server.ts
// Server-only I/O for the per-org PE root files. Defensive: a missing table,
// missing env or failed read degrades to "no root files" (skills then run on
// labelled default settings) — it never throws into a skill run.
//
// No `server-only` marker: like lib/skills/session-run.ts and lib/engine.ts it is
// only ever imported from server code, and the marker would make every test that
// imports the engine mock it. The service client it uses is the real guard.

import { createServiceClient, hasSupabaseServiceEnv } from "@/lib/supabase/server";
import { gateOwnerFor, SKILL_GATES } from "./gates";
import { resolveRootFiles, type ResolvedRootFiles, type RootFileRow } from "./root-files";

/**
 * Skills whose policy input defaults to the organization's stored root file.
 * Only an org's OWN settings are injected; otherwise the skill applies (and
 * labels) the standing default, so a default is never passed off as the firm's.
 */
type Binding = { input: "mandate" | "hurdles" | "financing" | "kpiPolicy" | "gateOwner" | "evidencePolicy" | "memoStructure" | "reportingStyle" };
export const ROOT_BINDINGS: Record<string, Binding[]> = {
  "mandate-screen": [{ input: "mandate" }],
  "target-screen": [{ input: "mandate" }],
  "first-look": [{ input: "mandate" }],
  "bid-range": [{ input: "hurdles" }],
  "exit-routes": [{ input: "hurdles" }],
  "final-investment-report": [{ input: "hurdles" }],
  "covenant-watch": [{ input: "financing" }],
  "cash-13-week": [{ input: "financing" }],
  "financing-terms": [{ input: "financing" }],
  "kpi-variance": [{ input: "kpiPolicy" }],
  "red-flag-register": [{ input: "evidencePolicy" }],
  "ic-memo": [{ input: "memoStructure" }],
  "lp-update": [{ input: "reportingStyle" }],
};
// Every PE skill ends on a human gate; the firm file may name its owner.
for (const skillId of Object.keys(SKILL_GATES)) {
  ROOT_BINDINGS[skillId] = [...(ROOT_BINDINGS[skillId] ?? []), { input: "gateOwner" }];
}

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
 * Fill each bound policy input the caller left out from the org's stored root
 * files. An explicit input always wins. Never throws.
 */
export async function withOrgMandate(orgId: string, skillId: string, input: unknown): Promise<unknown> {
  const bindings = ROOT_BINDINGS[skillId];
  if (!bindings) return input;
  if (!input || typeof input !== "object" || Array.isArray(input)) return input;
  const obj = input as Record<string, unknown>;
  const missing = bindings.filter((b) => obj[b.input] === undefined);
  if (missing.length === 0) return input;
  const root = await loadRootFiles(orgId);
  const out: Record<string, unknown> = { ...obj };
  for (const b of missing) {
    if (b.input === "mandate" && root.found.includes("mandate")) out.mandate = root.mandate;
    if (b.input === "hurdles" && !root.returnsAreDefault) out.hurdles = root.returns;
    if (b.input === "financing" && !root.financingIsDefault) out.financing = root.financing;
    if (b.input === "kpiPolicy" && !root.kpiIsDefault) out.kpiPolicy = root.kpi;
    if (b.input === "evidencePolicy" && !root.evidenceIsDefault) out.evidencePolicy = root.evidence;
    if (b.input === "memoStructure" && root.icMemo) out.memoStructure = root.icMemo;
    if (b.input === "reportingStyle" && root.reporting) out.reportingStyle = root.reporting;
    // Only a name the firm actually wrote; absent leaves the skill's labelled generic role.
    if (b.input === "gateOwner") {
      const owner = gateOwnerFor(skillId, root.firm);
      if (owner) out.gateOwner = owner;
    }
  }
  // Nothing the org has saved applied: hand back the caller's own object untouched.
  return Object.keys(out).length === Object.keys(obj).length ? input : out;
}
