"use server";

import { revalidatePath } from "next/cache";
import { createServerClient } from "@/lib/supabase/server";
import { getSessionContext } from "@/lib/auth";
import { integrationCatalog } from "@/lib/integrations/catalog";
import { GATEWAY_PROVIDER, mockAccountLabel } from "@/lib/integrations/gateway";

// Connect / disconnect an integration through the unified gateway. Writes go
// through the RLS-enforced server client (writer-write is the real gate). The
// gateway holds any OAuth tokens — we persist only a recognizable account handle
// and an opaque reference, so a row on its own is never a usable credential.

function isKnownChannel(channel: string): boolean {
  return integrationCatalog().some((d) => d.channel === channel);
}

export async function connectIntegration(formData: FormData): Promise<{ error?: string }> {
  const ctx = await getSessionContext();
  if (!ctx?.orgId) return { error: "Not authenticated" };
  const channel = String(formData.get("channel") ?? "");
  if (!isKnownChannel(channel)) return { error: "Unknown integration" };

  const supabase = createServerClient();
  // SEAM: a real gateway runs its hosted-auth handshake (Merge Link / Zernio
  // connect) here and returns the account handle + opaque ref. We record the
  // connection so dispatch and the composer treat the channel as live for this org.
  const { error } = await supabase.from("integration_connections").upsert(
    {
      organization_id: ctx.orgId,
      channel,
      status: "connected",
      gateway: GATEWAY_PROVIDER,
      account_label: mockAccountLabel(channel),
      account_ref: `${GATEWAY_PROVIDER}:${channel}:${ctx.orgId}`,
      connected_by: ctx.userId,
      revoked_at: null,
    },
    { onConflict: "organization_id,channel" },
  );

  if (error) return { error: error.message };
  revalidatePath("/settings");
  revalidatePath("/workspace");
  return {};
}

export async function disconnectIntegration(formData: FormData): Promise<{ error?: string }> {
  const ctx = await getSessionContext();
  if (!ctx?.orgId) return { error: "Not authenticated" };
  const channel = String(formData.get("channel") ?? "");
  if (!channel) return { error: "Missing integration" };

  const supabase = createServerClient();
  // An explicit revoked row overrides any env-level default, so disconnect is
  // honored even on a deploy that has the provider's env var set.
  const { error } = await supabase.from("integration_connections").upsert(
    {
      organization_id: ctx.orgId,
      channel,
      status: "revoked",
      gateway: GATEWAY_PROVIDER,
      revoked_at: new Date().toISOString(),
    },
    { onConflict: "organization_id,channel" },
  );

  if (error) return { error: error.message };
  revalidatePath("/settings");
  revalidatePath("/workspace");
  return {};
}
