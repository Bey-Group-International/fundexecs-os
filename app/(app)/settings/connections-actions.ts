"use server";

import { revalidatePath } from "next/cache";
import { createServerClient } from "@/lib/supabase/server";
import { getSessionContext } from "@/lib/auth";
import { integrationCatalog } from "@/lib/integrations/catalog";
import { GATEWAY_PROVIDER, mockAccountLabel } from "@/lib/integrations/gateway";
import { writeDashboardAudit } from "@/lib/dashboard/audit";

// Connect / disconnect an integration through the unified gateway. Writes go
// through the RLS-enforced server client (writer-write is the real gate). The
// gateway holds any OAuth tokens — we persist only a recognizable account handle
// and an opaque reference, so a row on its own is never a usable credential.
//
// The connection row is an UPSERT — it holds only the current state, so on its
// own each connect/disconnect would destroy the previous one. Every successful
// transition therefore also writes an append-only audit_log row
// (integration.connected / integration.revoked, with the prior status as
// before_state) so the org's connection history survives the upsert.

function isKnownChannel(channel: string): boolean {
  return integrationCatalog().some((d) => d.channel === channel);
}

// The channel's current gateway status, for the audit row's before_state.
// Best-effort: null (no row / read failure) reads as "never connected".
async function currentStatus(
  supabase: Awaited<ReturnType<typeof createServerClient>>,
  orgId: string,
  channel: string,
): Promise<string | null> {
  const { data } = await supabase
    .from("integration_connections")
    .select("status")
    .eq("organization_id", orgId)
    .eq("channel", channel)
    .maybeSingle();
  return data?.status ?? null;
}

export async function connectIntegration(formData: FormData): Promise<{ error?: string }> {
  const ctx = await getSessionContext();
  if (!ctx?.orgId) return { error: "Not authenticated" };
  const channel = String(formData.get("channel") ?? "");
  if (!isKnownChannel(channel)) return { error: "Unknown integration" };

  const supabase = await createServerClient();
  const priorStatus = await currentStatus(supabase, ctx.orgId, channel);

  // SEAM: a real gateway runs its hosted-auth handshake (Merge Link / Zernio
  // connect) here and returns the account handle + opaque ref. We record the
  // connection so dispatch and the composer treat the channel as live for this org.
  const accountLabel = mockAccountLabel(channel);
  const { error } = await supabase.from("integration_connections").upsert(
    {
      organization_id: ctx.orgId,
      channel,
      status: "connected",
      gateway: GATEWAY_PROVIDER,
      account_label: accountLabel,
      account_ref: `${GATEWAY_PROVIDER}:${channel}:${ctx.orgId}`,
      connected_by: ctx.userId,
      revoked_at: null,
    },
    { onConflict: "organization_id,channel" },
  );

  if (error) return { error: error.message };
  await writeDashboardAudit({
    organizationId: ctx.orgId,
    principalId: ctx.userId,
    action: "integration.connected",
    entityType: "integration_connection",
    beforeState: { channel, status: priorStatus },
    afterState: { channel, status: "connected", gateway: GATEWAY_PROVIDER, account_label: accountLabel },
  });
  revalidatePath("/settings");
  revalidatePath("/workspace");
  return {};
}

export async function disconnectIntegration(formData: FormData): Promise<{ error?: string }> {
  const ctx = await getSessionContext();
  if (!ctx?.orgId) return { error: "Not authenticated" };
  const channel = String(formData.get("channel") ?? "");
  if (!channel) return { error: "Missing integration" };

  const supabase = await createServerClient();
  const priorStatus = await currentStatus(supabase, ctx.orgId, channel);

  // An explicit revoked row overrides any env-level default, so disconnect is
  // honored even on a deploy that has the provider's env var set.
  const revokedAt = new Date().toISOString();
  const { error } = await supabase.from("integration_connections").upsert(
    {
      organization_id: ctx.orgId,
      channel,
      status: "revoked",
      gateway: GATEWAY_PROVIDER,
      revoked_at: revokedAt,
    },
    { onConflict: "organization_id,channel" },
  );

  if (error) return { error: error.message };
  await writeDashboardAudit({
    organizationId: ctx.orgId,
    principalId: ctx.userId,
    action: "integration.revoked",
    entityType: "integration_connection",
    beforeState: { channel, status: priorStatus },
    afterState: { channel, status: "revoked", gateway: GATEWAY_PROVIDER, revoked_at: revokedAt },
  });
  revalidatePath("/settings");
  revalidatePath("/workspace");
  return {};
}
