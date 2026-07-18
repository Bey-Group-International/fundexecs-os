// lib/terminal/store.ts
// Server-only persistence for the terminal (Release 1): the command_runs
// observability ledger and the workspace/layout round-trip. Org-scoped through
// the user-cookie client so RLS (member-read / writer-write) enforces tenancy —
// the store never widens access. The terminal tables are newer than the last
// generated DB types, so (exactly like lib/inference/store.ts) they are reached
// through a narrow unknown-cast. Everything here is best-effort: on any failure it
// returns null and never throws, so the terminal UI degrades rather than breaks.

import { createServerClient } from "@/lib/supabase/server";
import { serializeLayout, deserializeLayout, LAYOUT_VERSION, type Layout } from "./layout";
import type { WorkspacePreset } from "./layout";

type ServerDb = Awaited<ReturnType<typeof createServerClient>>;
// A loosely-typed view of the client for tables not yet in the generated types.
type UntypedClient = { from: (t: string) => ReturnType<ServerDb["from"]> };
const untyped = (c: ServerDb): UntypedClient => c as unknown as UntypedClient;

export interface LogCommandRunInput {
  orgId: string;
  principalId?: string | null;
  workspaceId?: string | null;
  sessionId?: string | null;
  verb: string;
  raw: string;
  sideEffectLevel: string;
  gateTier: number;
  dryRun?: boolean;
  status?: "succeeded" | "failed" | "rejected" | "pending_approval";
  error?: string | null;
}

/**
 * Append one command-execution record to command_runs — the terminal's audit /
 * observability spine (mirrors persistInferenceRun / persistSkillRun). Records
 * HOW the command was authorized (side-effect level + resolved gate tier) and how
 * it resolved. Best-effort; never throws.
 */
export async function logCommandRun(input: LogCommandRunInput): Promise<string | null> {
  const supabase = await createServerClient();
  const row = {
    organization_id: input.orgId,
    principal_id: input.principalId ?? null,
    workspace_id: input.workspaceId ?? null,
    session_id: input.sessionId ?? null,
    verb: input.verb,
    raw: input.raw,
    side_effect_level: input.sideEffectLevel,
    gate_tier: input.gateTier,
    dry_run: input.dryRun ?? false,
    status: input.status ?? "succeeded",
    error: input.error ?? null,
  };
  try {
    const { data, error } = await untyped(supabase)
      .from("command_runs")
      .insert(row as never)
      .select("id")
      .maybeSingle();
    if (!error && data) return (data as unknown as { id: string }).id;
  } catch {
    // swallow — the ledger is best-effort and must never break a command.
  }
  return null;
}

export interface TerminalWorkspaceState {
  workspaceId: string;
  layoutId: string | null;
  layout: Layout;
  presetKey: string;
}

/**
 * Load the principal's default terminal workspace + its layout, or null when none
 * has been saved yet (the caller then seeds a preset in memory). "Default" is the
 * most-recently-updated non-deleted workspace the principal owns in this org.
 */
export async function loadTerminalWorkspace(
  orgId: string,
  principalId: string,
): Promise<TerminalWorkspaceState | null> {
  const supabase = await createServerClient();
  try {
    const { data: ws } = await untyped(supabase)
      .from("terminal_workspaces")
      .select("id, preset_key")
      .eq("organization_id", orgId)
      .eq("owner_principal_id", principalId)
      .is("deleted_at", null)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!ws) return null;
    const workspace = ws as unknown as { id: string; preset_key: string };

    const { data: lay } = await untyped(supabase)
      .from("terminal_layouts")
      .select("id, layout")
      .eq("workspace_id", workspace.id)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    const layoutRow = lay as unknown as { id: string; layout: unknown } | null;

    return {
      workspaceId: workspace.id,
      layoutId: layoutRow?.id ?? null,
      layout: deserializeLayout(layoutRow?.layout),
      presetKey: workspace.preset_key ?? "custom",
    };
  } catch {
    return null;
  }
}

/**
 * Persist the principal's terminal layout, reusing their default workspace if one
 * exists (creating it otherwise). Returns the workspace id, or null on failure.
 * Best-effort; never throws.
 */
export async function saveTerminalLayout(
  orgId: string,
  principalId: string,
  layout: Layout,
  preset: WorkspacePreset = "custom",
): Promise<string | null> {
  const supabase = await createServerClient();
  const serialized = serializeLayout(layout);
  try {
    // Reuse the default workspace, or create one.
    let workspaceId: string | null = null;
    const { data: existing } = await untyped(supabase)
      .from("terminal_workspaces")
      .select("id")
      .eq("organization_id", orgId)
      .eq("owner_principal_id", principalId)
      .is("deleted_at", null)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    workspaceId = (existing as unknown as { id: string } | null)?.id ?? null;

    if (!workspaceId) {
      const { data: created, error } = await untyped(supabase)
        .from("terminal_workspaces")
        .insert({
          organization_id: orgId,
          owner_principal_id: principalId,
          name: "Terminal",
          preset_key: preset,
        } as never)
        .select("id")
        .maybeSingle();
      if (error || !created) return null;
      workspaceId = (created as unknown as { id: string }).id;
    } else {
      // Touch updated_at so "most recent" ordering reflects the save.
      await untyped(supabase)
        .from("terminal_workspaces")
        .update({ last_opened_at: new Date().toISOString() } as never)
        .eq("id", workspaceId);
    }

    // Upsert the single layout row for this workspace.
    const { data: layRow } = await untyped(supabase)
      .from("terminal_layouts")
      .select("id")
      .eq("workspace_id", workspaceId)
      .limit(1)
      .maybeSingle();
    const layoutId = (layRow as unknown as { id: string } | null)?.id ?? null;

    if (layoutId) {
      await untyped(supabase)
        .from("terminal_layouts")
        .update({ layout: serialized as never, layout_version: LAYOUT_VERSION } as never)
        .eq("id", layoutId);
    } else {
      await untyped(supabase)
        .from("terminal_layouts")
        .insert({
          organization_id: orgId,
          workspace_id: workspaceId,
          layout: serialized as never,
          layout_version: LAYOUT_VERSION,
        } as never);
    }
    return workspaceId;
  } catch {
    return null;
  }
}
