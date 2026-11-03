"use server";

// Writers for the per-organization PE root files (org_pe_root_files). Firm policy,
// so every write is owner/admin only, matching the table's RLS.
//
// Governance rules enforced here (the pure ones live in lib/pe/root-file-edit.ts):
//   * a save stores the PARSED value, never the raw text;
//   * any edit of the mandate resets it to draft — an edit un-signs it;
//   * the mandate is approved only by approveMandate(), and only when it has no
//     audit blockers. The approver recorded is the signed-in user, not free text.
import { revalidatePath } from "next/cache";
import { createServerClient } from "@/lib/supabase/server";
import { getSessionContext, type SessionContext } from "@/lib/auth";
import { writeDashboardAudit } from "@/lib/dashboard/audit";
import type { Json } from "@/lib/supabase/database.types";
import { isRootFileKey, type RootFileKey } from "@/lib/pe/root-files";
import { mandateApprovalBlockers, validateRootFileText } from "@/lib/pe/root-file-edit";
import { parseMandateTests } from "@/lib/pe/mandate-tests";

export interface PeRootFileResult {
  ok: boolean;
  error?: string;
  warnings?: string[];
  /** Mandate only: audit findings on what was saved / why approval is blocked. */
  issues?: string[];
}

function canManage(ctx: SessionContext | null): ctx is SessionContext & { orgId: string } {
  return Boolean(ctx?.orgId) && (ctx?.role === "owner" || ctx?.role === "admin");
}

const DENIED: PeRootFileResult = { ok: false, error: "Only organization owners and admins can edit the firm's PE settings." };

interface StoredRow {
  content: unknown;
  version: number | null;
}

async function readRow(orgId: string, key: RootFileKey): Promise<StoredRow | null> {
  const supabase = await createServerClient();
  const { data } = await supabase.from("org_pe_root_files" as never).select("content, version").eq("organization_id", orgId).eq("file_key", key).maybeSingle();
  return (data as StoredRow | null) ?? null;
}

async function writeRow(ctx: SessionContext & { orgId: string }, key: RootFileKey, content: Record<string, unknown>, prev: StoredRow | null): Promise<string | null> {
  const supabase = await createServerClient();
  const { error } = await supabase.from("org_pe_root_files" as never).upsert(
    {
      organization_id: ctx.orgId,
      file_key: key,
      content: content as Json,
      version: (prev?.version ?? 0) + 1,
      updated_by: ctx.userId,
    } as never,
    { onConflict: "organization_id,file_key" },
  );
  return error ? error.message : null;
}

/** Validate, normalise and store one root file. */
export async function savePeRootFile(key: string, text: string): Promise<PeRootFileResult> {
  const ctx = await getSessionContext();
  if (!canManage(ctx)) return DENIED;
  if (!isRootFileKey(key)) return { ok: false, error: "Unknown root file." };

  const v = validateRootFileText(key, text);
  if (!v.ok || !v.normalized) return { ok: false, error: v.errors.join(" ") };

  const prev = await readRow(ctx.orgId, key);
  const err = await writeRow(ctx, key, v.normalized, prev);
  if (err) return { ok: false, error: err };

  await writeDashboardAudit({
    organizationId: ctx.orgId,
    principalId: ctx.userId,
    action: `pe_root_file.${key}.saved`,
    entityType: "org_pe_root_file",
    entityId: key,
    beforeState: (prev?.content ?? null) as Json,
    afterState: v.normalized as Json,
  }).catch(() => undefined);

  revalidatePath("/settings/pe-firm");
  return { ok: true, warnings: v.warnings, issues: v.mandateIssues?.map((i) => `${i.severity === "blocker" ? "Blocker" : "Warning"}: ${i.message}`) };
}

/** Approve the stored mandate. Blocked while the audit finds a blocker. Records the signed-in user as approver. */
export async function approvePeMandate(): Promise<PeRootFileResult> {
  const ctx = await getSessionContext();
  if (!canManage(ctx)) return DENIED;

  const prev = await readRow(ctx.orgId, "mandate");
  const mandate = parseMandateTests(prev?.content ?? null);
  const blockers = mandateApprovalBlockers(mandate);
  if (blockers.length || !mandate) return { ok: false, error: "The mandate cannot be approved yet.", issues: blockers };

  const approved = { ...mandate, status: "approved" as const, approvedBy: ctx.email };
  const err = await writeRow(ctx, "mandate", approved as unknown as Record<string, unknown>, prev);
  if (err) return { ok: false, error: err };

  await writeDashboardAudit({
    organizationId: ctx.orgId,
    principalId: ctx.userId,
    action: "pe_root_file.mandate.approved",
    entityType: "org_pe_root_file",
    entityId: "mandate",
    afterState: { approvedBy: ctx.email, criteria: mandate.hardLimits.length + mandate.preferences.length + mandate.killFacts.length } as Json,
  }).catch(() => undefined);

  revalidatePath("/settings/pe-firm");
  return { ok: true };
}

/** Remove a root file; skills fall back to the labelled standing defaults. */
export async function clearPeRootFile(key: string): Promise<PeRootFileResult> {
  const ctx = await getSessionContext();
  if (!canManage(ctx)) return DENIED;
  if (!isRootFileKey(key)) return { ok: false, error: "Unknown root file." };

  const supabase = await createServerClient();
  const prev = await readRow(ctx.orgId, key);
  const { error } = await supabase.from("org_pe_root_files" as never).delete().eq("organization_id", ctx.orgId).eq("file_key", key);
  if (error) return { ok: false, error: error.message };

  await writeDashboardAudit({
    organizationId: ctx.orgId,
    principalId: ctx.userId,
    action: `pe_root_file.${key}.cleared`,
    entityType: "org_pe_root_file",
    entityId: key,
    beforeState: (prev?.content ?? null) as Json,
  }).catch(() => undefined);

  revalidatePath("/settings/pe-firm");
  return { ok: true };
}
