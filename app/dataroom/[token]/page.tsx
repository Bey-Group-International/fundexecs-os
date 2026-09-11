import { createServiceClient, hasSupabaseServiceEnv } from "@/lib/supabase/server";
import { gateSatisfied, readGatePass } from "@/lib/data-room-gate";
import { buildViewerPayload, EMPTY_BLENDED } from "@/lib/data-room-viewer.server";
import type { Organization, DataRoomShare } from "@/lib/supabase/database.types";
import { DataRoomViewer } from "@/components/dataroom/DataRoomViewer";
import type { GateConfig } from "@/components/dataroom/DataRoomViewer";

// Public, read-only data room — outside the authed (app) group so it's
// reachable without a login. The token is the sole gate.
export const dynamic = "force-dynamic";

function Unavailable() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-surface-0 px-6 text-center">
      <span className="font-mono text-[11px] uppercase tracking-[0.16em] text-gold-300">FundExecs OS</span>
      <h1 className="mt-3 font-display text-2xl font-semibold text-fg-primary">This data room isn&apos;t available</h1>
      <p className="mt-2 max-w-sm text-sm text-fg-secondary">
        The link is invalid, has expired, or has been revoked. Ask the sender for a fresh link.
      </p>
    </main>
  );
}

export default async function PublicDataRoom(props: { params: Promise<{ token: string }> }) {
  const params = await props.params;
  if (!hasSupabaseServiceEnv()) return <Unavailable />;
  const supabase = createServiceClient();

  const { data: shareRow } = await supabase
    .from("data_room_shares")
    .select("*")
    .eq("token", params.token)
    .maybeSingle();
  const share = shareRow as DataRoomShare | null;
  if (!share || share.revoked_at) return <Unavailable />;
  if (share.expires_at && new Date(share.expires_at).getTime() < Date.now()) return <Unavailable />;

  const orgId = share.organization_id;
  // Every link is scoped to a room. A share with no room predates the split and
  // has nothing to show rather than falling back to the whole library.
  const roomId = share.room_id;
  if (!roomId) return <Unavailable />;

  // Log the visit regardless of gate status — this tracks link opens, not
  // gate completion. Fire-and-forget.
  await supabase
    .from("data_room_views")
    .insert({ organization_id: orgId, share_id: share.id, room_id: roomId, kind: "room" })
    .then(() => undefined, () => undefined);

  const gateConfig: GateConfig = {
    requireEmail: share.require_email ?? false,
    requireNda: share.require_nda ?? false,
    ndaText: share.nda_text ?? null,
    passwordProtected: Boolean(share.password_hash),
  };

  // The gate is enforced HERE, before any confidential data is fetched — not
  // by hiding already-fetched content behind client-side CSS. Only a visitor
  // whose server-verified pass satisfies every currently-required gate gets
  // the real queries below; everyone else gets a minimal branding-only render
  // (name/logo/accent — not confidential) plus the gate UI.
  const pass = await readGatePass(share.id);
  const passed = gateSatisfied(
    { require_email: gateConfig.requireEmail, require_nda: gateConfig.requireNda, password_hash: share.password_hash },
    pass,
  );

  if (!passed) {
    const { data: brandRow } = await supabase
      .from("organizations")
      .select("name, tagline, brand_color, logo_url")
      .eq("id", orgId)
      .maybeSingle();
    if (!brandRow) return <Unavailable />;
    const brand = brandRow as Pick<Organization, "name" | "tagline" | "brand_color" | "logo_url">;

    return (
      <DataRoomViewer
        token={params.token}
        shareId={share.id}
        org={{
          name: brand.name,
          tagline: brand.tagline ?? null,
          legal_name: null,
          entity_type: null,
          jurisdiction: null,
          website: null,
          brand_color: brand.brand_color ?? null,
          logo_url: brand.logo_url ?? null,
        }}
        blended={EMPTY_BLENDED}
        thesis={null}
        team={[]}
        entities={[]}
        docSections={[]}
        gateConfig={gateConfig}
        contentReady={false}
      />
    );
  }

  // One builder serves this page and the GP-side preview, so "what will they
  // see?" is answered by the same code that renders what they do see.
  const payload = await buildViewerPayload(supabase, orgId, roomId, share.allowed_sections ?? null);
  if (!payload) return <Unavailable />;

  return (
    <DataRoomViewer
      token={params.token}
      shareId={share.id}
      org={payload.org}
      blended={payload.blended}
      thesis={payload.thesis}
      team={payload.team}
      entities={payload.entities}
      docSections={payload.docSections}
      gateConfig={gateConfig}
      contentReady
    />
  );
}
