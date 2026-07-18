"use server";

// Server actions for the terminal shell. Two write paths, both authenticated +
// flag-guarded: recording a command run (the audit ledger) and persisting the
// pane layout. Authorization for the ledger is RE-DERIVED server-side from the raw
// command text — the client's claimed tier is never trusted, and a gated command
// can never be recorded as "succeeded".

import { requireOrgContext } from "@/lib/auth";
import { TERMINAL_ENABLED } from "@/lib/terminal/config";
import { planCommand } from "@/lib/terminal/dispatch";
import { logCommandRun, saveTerminalLayout } from "@/lib/terminal/store";
import { deserializeLayout } from "@/lib/terminal/layout";

export interface RecordCommandInput {
  raw: string;
  dryRun?: boolean;
  status?: "succeeded" | "failed" | "rejected" | "pending_approval";
  workspaceId?: string | null;
  error?: string | null;
}

/**
 * Record one command dispatch to command_runs. Returns the row id (or null). The
 * side-effect level + gate tier are resolved from the command registry on the
 * server, and any command that requires approval is clamped to "pending_approval"
 * — the terminal never records a gated action as executed.
 */
export async function recordCommandRun(input: RecordCommandInput): Promise<string | null> {
  if (!TERMINAL_ENABLED) return null;
  const auth = await requireOrgContext();
  if (!auth.ok) return null;

  const plan = planCommand(input.raw);
  // Only recognized commands are ledgered; the NL fallback isn't a command run.
  if (!plan.parsed || !plan.classification) return null;

  // Governance clamp: a gated command is never recorded as succeeded. If the
  // caller didn't already mark it pending/rejected, force pending_approval.
  let status = input.status ?? "succeeded";
  if (plan.requiresApproval && status === "succeeded") status = "pending_approval";

  return logCommandRun({
    orgId: auth.ctx.orgId,
    principalId: auth.ctx.userId,
    workspaceId: input.workspaceId ?? null,
    verb: plan.parsed.command.verb,
    raw: input.raw,
    sideEffectLevel: plan.parsed.command.sideEffect,
    gateTier: plan.classification.tier,
    dryRun: input.dryRun ?? false,
    status,
    error: input.error ?? null,
  });
}

/**
 * Persist the terminal layout for the current principal. Accepts the serialized
 * layout JSON (from serializeLayout); it is re-sanitized through deserializeLayout
 * before storage. Returns the workspace id, or null.
 */
export async function persistLayout(serialized: unknown): Promise<string | null> {
  if (!TERMINAL_ENABLED) return null;
  const auth = await requireOrgContext();
  if (!auth.ok) return null;
  const layout = deserializeLayout(serialized);
  return saveTerminalLayout(auth.ctx.orgId, auth.ctx.userId, layout);
}
