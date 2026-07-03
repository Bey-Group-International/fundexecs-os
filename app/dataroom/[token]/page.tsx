import { createServiceClient, hasSupabaseServiceEnv } from "@/lib/supabase/server";
import { blendTrackRecord } from "@/lib/track-record";
import { DATA_ROOM_SECTIONS } from "@/lib/data-room";
import { gateSatisfied, readGatePass } from "@/lib/data-room-gate";
import type {
  Organization,
  InvestmentThesis,
  TrackRecord,
  Entity,
  OrganizationMember,
  Principal,
  Document,
  DataRoomShare,
} from "@/lib/supabase/database.types";
import { DataRoomViewer } from "@/components/dataroom/DataRoomViewer";
import type {
  ViewerOrg,
  ViewerTrackRecord,
  ViewerThesis,
  ViewerTeamMember,
  ViewerEntity,
  ViewerSection,
  ViewerDoc,
  GateConfig,
} from "@/components/dataroom/DataRoomViewer";

// Public, read-only data room — outside the authed (app) group so it's
// reachable without a login. The token is the sole gate.
export const dynamic = "force-dynamic";

function Unavailable() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-surface-0 px-6 text-center">
      <span className="font-mono text-[11px] uppercase tracking-[0.25em] text-gold-400">FundExecs OS</span>
      <h1 className="mt-3 font-display text-2xl font-semibold text-fg-primary">This data room isn&apos;t available</h1>
      <p className="mt-2 max-w-sm text-sm text-fg-secondary">
        The link is invalid, has expired, or has been revoked. Ask the sender for a fresh link.
      </p>
    </main>
  );
}

const EMPTY_BLENDED: ViewerTrackRecord = {
  dealCount: 0,
  realizedCount: 0,
  weightedGrossIrr: null,
  pooledMoic: null,
  dpi: null,
  totalInvested: null,
  vintageRange: null,
};

export default async function PublicDataRoom({ params }: { params: { token: string } }) {
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

  // Log the visit regardless of gate status — this tracks link opens, not
  // gate completion. Fire-and-forget.
  await supabase
    .from("data_room_views")
    .insert({ organization_id: orgId, share_id: share.id, kind: "room" })
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

  const [orgRes, thesisRes, recordsRes, entitiesRes, membersRes, docsRes] = await Promise.all([
    supabase.from("organizations").select("*").eq("id", orgId).maybeSingle(),
    supabase
      .from("investment_theses")
      .select("*")
      .eq("organization_id", orgId)
      .order("is_active", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase.from("track_records").select("*").eq("organization_id", orgId).order("vintage_year", { ascending: false }),
    supabase.from("entities").select("*").eq("organization_id", orgId),
    supabase.from("organization_members").select("*").eq("organization_id", orgId),
    supabase
      .from("documents")
      .select("*")
      .eq("organization_id", orgId)
      .eq("status", "ready")
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: true }),
  ]);

  const org = orgRes.data as Organization | null;
  if (!org) return <Unavailable />;
  const thesis = thesisRes.data as InvestmentThesis | null;
  const records = (recordsRes.data ?? []) as TrackRecord[];
  const entities = (entitiesRes.data ?? []) as Entity[];
  const members = (membersRes.data ?? []) as OrganizationMember[];
  const documents = (docsRes.data ?? []) as Document[];

  let principals: Principal[] = [];
  if (members.length) {
    const { data } = await supabase
      .from("principals")
      .select("*")
      .in("id", members.map((m) => m.principal_id));
    principals = (data ?? []) as Principal[];
  }
  const byId = new Map(principals.map((p) => [p.id, p]));
  const blended = blendTrackRecord(records);

  // Group ready documents by section.
  const docsBySection = new Map<string, ViewerDoc[]>();
  for (const d of documents) {
    const k = d.doc_type ?? "other";
    const doc: ViewerDoc = {
      id: d.id,
      name: d.name,
      content: d.content ?? null,
      storage_key: d.storage_key ?? null,
      doc_type: d.doc_type ?? null,
    };
    const bucket = docsBySection.get(k);
    if (bucket) bucket.push(doc);
    else docsBySection.set(k, [doc]);
  }

  // Build ordered section list (only sections that have ready docs).
  // If the share has an allowed_sections whitelist, filter to only those keys.
  const allowedSections = (share as { allowed_sections?: string[] | null }).allowed_sections ?? null;
  const docSections: ViewerSection[] = DATA_ROOM_SECTIONS
    .map((s) => ({ key: s.key, label: s.label, docs: docsBySection.get(s.key) ?? [] }))
    .filter((s) => s.docs.length > 0)
    .filter((s) => !allowedSections || allowedSections.includes(s.key));

  // Serialize for client component.
  const viewerOrg: ViewerOrg = {
    name: org.name,
    tagline: org.tagline ?? null,
    legal_name: org.legal_name ?? null,
    entity_type: org.entity_type ?? null,
    jurisdiction: org.jurisdiction ?? null,
    website: org.website ?? null,
    brand_color: org.brand_color ?? null,
    logo_url: org.logo_url ?? null,
  };

  const viewerBlended: ViewerTrackRecord = {
    dealCount: blended.dealCount,
    realizedCount: blended.realizedCount,
    weightedGrossIrr: blended.weightedGrossIrr ?? null,
    pooledMoic: blended.pooledMoic ?? null,
    dpi: blended.dpi ?? null,
    totalInvested: blended.totalInvested ?? null,
    vintageRange: blended.vintageRange ?? null,
  };

  const viewerThesis: ViewerThesis | null = thesis
    ? {
        title: thesis.title,
        summary: thesis.summary ?? null,
        asset_classes: thesis.asset_classes ?? null,
        geographies: thesis.geographies ?? null,
        target_irr: thesis.target_irr ?? null,
        target_moic: thesis.target_moic ?? null,
        check_size_min: thesis.check_size_min ?? null,
        check_size_max: thesis.check_size_max ?? null,
      }
    : null;

  const viewerTeam: ViewerTeamMember[] = members.map((m) => {
    const p = byId.get(m.principal_id);
    return {
      name: p?.full_name || p?.email || "Member",
      title: p?.title ?? null,
      email: p?.email ?? null,
    };
  });

  const viewerEntities: ViewerEntity[] = entities.map((e) => ({
    name: e.name,
    entity_type: (e as { entity_type?: string | null }).entity_type ?? null,
  }));

  return (
    <DataRoomViewer
      token={params.token}
      shareId={share.id}
      org={viewerOrg}
      blended={viewerBlended}
      thesis={viewerThesis}
      team={viewerTeam}
      entities={viewerEntities}
      docSections={docSections}
      gateConfig={gateConfig}
      contentReady
    />
  );
}
