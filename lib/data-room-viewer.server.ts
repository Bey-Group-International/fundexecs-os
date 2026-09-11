// lib/data-room-viewer.server.ts
// One builder for what an LP sees in a room, shared by the public viewer and
// the GP-side "Preview as LP" pane.
//
// This exists because the two used to be built separately and had already
// drifted: the internal page rendered a branded sheet that resembled the LP
// view but was assembled from different queries, so "what will they see?" was
// answered by a lookalike rather than the real thing. Both callers now run this
// function, so a preview that differs from the live room is impossible.
import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { blendTrackRecord } from "@/lib/track-record";
import { DATA_ROOM_SECTIONS } from "@/lib/data-room";
import { sectionsAllowedBy } from "@/lib/data-rooms";
import type { Database } from "@/lib/supabase/database.types";
import type {
  Organization,
  InvestmentThesis,
  TrackRecord,
  Entity,
  OrganizationMember,
  Principal,
  Document,
} from "@/lib/supabase/database.types";
import type {
  ViewerOrg,
  ViewerTrackRecord,
  ViewerThesis,
  ViewerTeamMember,
  ViewerEntity,
  ViewerSection,
  ViewerDoc,
} from "@/components/dataroom/DataRoomViewer";

export interface ViewerPayload {
  org: ViewerOrg;
  blended: ViewerTrackRecord;
  thesis: ViewerThesis | null;
  team: ViewerTeamMember[];
  entities: ViewerEntity[];
  docSections: ViewerSection[];
}

export const EMPTY_BLENDED: ViewerTrackRecord = {
  dealCount: 0,
  realizedCount: 0,
  weightedGrossIrr: null,
  pooledMoic: null,
  dpi: null,
  totalInvested: null,
  vintageRange: null,
};

type Client = SupabaseClient<Database>;

/**
 * Assemble everything a viewer renders for one room: firm identity, the Build
 * foundation an allocator reads first, and the documents *published into this
 * room*, narrowed by a link's section allowlist.
 *
 * Returns null when the org is missing. Documents come from the room's publish
 * manifest — never the org's whole library — so an unpublished draft cannot
 * appear here for either caller.
 */
export async function buildViewerPayload(
  supabase: Client,
  orgId: string,
  roomId: string,
  allowedSections: string[] | null,
): Promise<ViewerPayload | null> {
  const { data: manifestRows } = await supabase
    .from("data_room_documents")
    .select("document_id, sort_order")
    .eq("organization_id", orgId)
    .eq("room_id", roomId)
    .order("sort_order", { ascending: true });
  const manifest = (manifestRows ?? []) as { document_id: string; sort_order: number }[];
  const manifestOrder = new Map(manifest.map((m) => [m.document_id, m.sort_order ?? 0]));

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
    supabase
      .from("track_records")
      .select("*")
      .eq("organization_id", orgId)
      .order("vintage_year", { ascending: false }),
    supabase.from("entities").select("*").eq("organization_id", orgId),
    supabase.from("organization_members").select("*").eq("organization_id", orgId),
    manifest.length
      ? supabase
          .from("documents")
          .select("*")
          .eq("organization_id", orgId)
          .in("id", manifest.map((m) => m.document_id))
      : Promise.resolve({ data: [] as Document[] }),
  ]);

  const org = orgRes.data as Organization | null;
  if (!org) return null;

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

  // Group published documents by section, in the order the room sets.
  const ordered = [...documents].sort(
    (a, b) =>
      (manifestOrder.get(a.id) ?? 0) - (manifestOrder.get(b.id) ?? 0) || a.name.localeCompare(b.name),
  );
  const docsBySection = new Map<string, ViewerDoc[]>();
  for (const d of ordered) {
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

  const docSections: ViewerSection[] = sectionsAllowedBy(
    allowedSections,
    DATA_ROOM_SECTIONS.map((s) => ({
      key: s.key,
      label: s.label,
      docs: docsBySection.get(s.key) ?? [],
    })).filter((s) => s.docs.length > 0),
  );

  return {
    org: {
      name: org.name,
      tagline: org.tagline ?? null,
      legal_name: org.legal_name ?? null,
      entity_type: org.entity_type ?? null,
      jurisdiction: org.jurisdiction ?? null,
      website: org.website ?? null,
      brand_color: org.brand_color ?? null,
      logo_url: org.logo_url ?? null,
    },
    blended: {
      dealCount: blended.dealCount,
      realizedCount: blended.realizedCount,
      weightedGrossIrr: blended.weightedGrossIrr ?? null,
      pooledMoic: blended.pooledMoic ?? null,
      dpi: blended.dpi ?? null,
      totalInvested: blended.totalInvested ?? null,
      vintageRange: blended.vintageRange ?? null,
    },
    thesis: thesis
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
      : null,
    team: members.map((m) => {
      const p = byId.get(m.principal_id);
      return {
        name: p?.full_name || p?.email || "Member",
        title: p?.title ?? null,
        email: p?.email ?? null,
      };
    }),
    entities: entities.map((e) => ({
      name: e.name,
      entity_type: (e as { entity_type?: string | null }).entity_type ?? null,
    })),
    docSections,
  };
}
