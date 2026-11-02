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
import { buildPagesAllowedBy, roomSectionKey, sectionsAllowedBy } from "@/lib/data-rooms";
import { selectAllPages, selectInBatches } from "@/lib/supabase/batch";
import { DataRoomReadError } from "@/lib/data-room-errors";
import { isUploadedFile, previewKindFor } from "@/lib/document-files";
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
  ViewerRoom,
  ViewerTrackRecord,
  ViewerThesis,
  ViewerTeamMember,
  ViewerEntity,
  ViewerSection,
  ViewerDoc,
} from "@/components/dataroom/DataRoomViewer";

export interface ViewerPayload {
  org: ViewerOrg;
  room: ViewerRoom;
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
/**
 * Whether a room is still open to the outside world.
 *
 * Archiving a room is meant to end its exposure, but the only thing that
 * previously stopped a token was `revoked_at` on the share. Archiving revokes
 * the room's links as a second write, so any failure of that write left an
 * archived room still serving documents through links the operator believes
 * are dead — and invisible to them, since archived rooms leave the switcher.
 * Both public surfaces check this directly, so the room's own state is the
 * boundary rather than a bookkeeping step that has to succeed.
 *
 * A read that errored throws DataRoomReadError. It is not evidence the room is
 * open, so nothing is served, but it is not evidence the room is closed either:
 * a caller must be able to say "try again" rather than "this link is dead".
 */
export async function isRoomOpen(
  supabase: Client,
  orgId: string,
  roomId: string,
): Promise<boolean> {
  const { data, error } = await supabase
    .from("data_rooms")
    .select("id")
    .eq("id", roomId)
    .eq("organization_id", orgId)
    .is("archived_at", null)
    .maybeSingle();
  if (error) throw new DataRoomReadError("room", error);
  return Boolean(data);
}

/**
 * When a document last changed, and whether that is after this reader's previous
 * visit. A first visit has no previous one, so nothing is marked new: marking
 * everything would say nothing.
 */
function changeInfo(
  d: { updated_at?: string | null; created_at?: string | null },
  addedToRoomAt: string | null | undefined,
  lastVisitAt: string | null | undefined,
): { updatedAt: string | null; isNew: boolean } {
  const updatedAt = d.updated_at ?? d.created_at ?? null;
  // New is whichever is later: the document changed, or it was published into
  // this room. An old document published after the reader's last visit is new to
  // them, though its own date is old.
  const latest = [updatedAt, addedToRoomAt]
    .filter((t): t is string => Boolean(t))
    .map((t) => new Date(t).getTime())
    .sort((a, b) => b - a)[0];
  const isNew = Boolean(lastVisitAt) && latest !== undefined && latest > new Date(lastVisitAt as string).getTime();
  return { updatedAt, isNew };
}

/**
 * When this reader was last here, for marking what changed since. Rows from the
 * last half hour are this visit (the page can render more than once, and reading
 * time is recorded as it goes), so they do not count. Only a reader who passed an
 * email gate can be recognised, and only a failed or empty lookup is "no previous
 * visit": a cosmetic marker must never take the room down.
 */
export async function previousVisitAt(
  supabase: Client,
  shareId: string,
  email: string | null,
): Promise<string | null> {
  if (!email) return null;
  const cutoff = new Date(Date.now() - 30 * 60_000).toISOString();
  const { data, error } = await supabase
    .from("data_room_views")
    .select("created_at")
    .eq("share_id", shareId)
    .eq("viewer_email", email)
    .lt("created_at", cutoff)
    .order("created_at", { ascending: false })
    .limit(1);
  if (error) return null;
  return ((data ?? []) as { created_at: string }[])[0]?.created_at ?? null;
}

export async function buildViewerPayload(
  supabase: Client,
  orgId: string,
  roomId: string,
  /** A link's section allowlist. `null` = unrestricted; `[]` allows nothing. */
  allowedSections: string[] | null,
  /** Single-document link: show only this document, published or not. */
  documentId: string | null = null,
  /**
   * Who is looking. Files that require a signature are locked (their content
   * and file reference withheld from the payload) unless this reader has
   * signed on this link. Omitted — the GP preview — means unsigned.
   */
  reader: { shareId: string; email: string | null; lastVisitAt?: string | null } | null = null,
): Promise<ViewerPayload | null> {
  if (!(await isRoomOpen(supabase, orgId, roomId))) return null;

  let manifest: { document_id: string; sort_order: number; created_at?: string }[];
  // For a room link the signature requirement comes from the SAME read as the
  // membership: two reads could straddle an unpublish, leaving a document that is
  // still returned below but absent from the requirement lookup, so it would be
  // served unlocked.
  let manifestSig: { document_id: string; require_signature: boolean }[] | null = null;
  if (documentId) {
    manifest = [{ document_id: documentId, sort_order: 0 }];
  } else {
    // Paged: one request is capped at max_rows, and a room past that would
    // silently lose its last files. sort_order is unique per room, so the
    // pages neither skip nor repeat rows.
    const { data: manifestRows, error: manifestErr } = await selectAllPages<{
      document_id: string;
      sort_order: number;
      require_signature: boolean;
      created_at: string;
    }>((from, to) =>
      supabase
        .from("data_room_documents")
        .select("document_id, sort_order, require_signature, created_at")
        .eq("organization_id", orgId)
        .eq("room_id", roomId)
        .order("sort_order", { ascending: true })
        .range(from, to),
    );
    // An errored read is not an empty room.
    if (manifestErr) throw new DataRoomReadError("manifest", manifestErr);
    const rows = (manifestRows ?? []) as {
      document_id: string;
      sort_order: number;
      require_signature: boolean;
      created_at: string;
    }[];
    manifest = rows;
    manifestSig = rows;
  }
  const manifestOrder = new Map(manifest.map((m) => [m.document_id, m.sort_order ?? 0]));
  const addedToRoom = new Map(manifest.map((m) => [m.document_id, m.created_at]));

  // Which of these files need a signature, and which this reader has signed.
  // The manifest row is the source of truth even for a single-document link.
  const { data: sigRows, error: sigErr } = manifestSig
    ? { data: manifestSig, error: null }
    : await selectInBatches<{ document_id: string; require_signature: boolean }>(
        manifest.map((m) => m.document_id),
        (batch) =>
          supabase
            .from("data_room_documents")
            .select("document_id, require_signature")
            .eq("organization_id", orgId)
            .eq("room_id", roomId)
            .in("document_id", batch),
      );
  // If this read errored, `needsSignature` would be empty and every file that
  // requires a signature would be served unlocked. Nothing is served instead.
  if (sigErr) throw new DataRoomReadError("signature-requirement", sigErr);
  const needsSignature = new Set(
    ((sigRows ?? []) as { document_id: string; require_signature: boolean }[])
      .filter((r) => r.require_signature)
      .map((r) => r.document_id),
  );
  const signed =
    reader && needsSignature.size
      ? await (await import("@/lib/document-signing.server")).signedDocumentIds(
          supabase as never,
          reader.shareId,
          reader.email,
          [...needsSignature],
        )
      : new Set<string>();

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
    // Batched: every id in one `.in()` overflows the request URL for a big
    // room, which used to take the whole file list down with it.
    selectInBatches<Document>(
      manifest.map((m) => m.document_id),
      (batch) =>
        supabase
          .from("documents")
          .select("*")
          .eq("organization_id", orgId)
          .in("id", batch) as unknown as PromiseLike<{ data: Document[] | null; error: { message: string } | null }>,
    ),
  ]);

  // Every read must have answered. A failed one is not an empty one: a missing
  // track record or team would read as the firm having none, and a failed
  // document read as an empty room.
  if (orgRes.error) throw new DataRoomReadError("organization", orgRes.error);
  if (thesisRes.error) throw new DataRoomReadError("thesis", thesisRes.error);
  if (recordsRes.error) throw new DataRoomReadError("track-records", recordsRes.error);
  if (entitiesRes.error) throw new DataRoomReadError("entities", entitiesRes.error);
  if (membersRes.error) throw new DataRoomReadError("members", membersRes.error);
  if (docsRes.error) throw new DataRoomReadError("documents", docsRes.error);

  const org = orgRes.data as Organization | null;
  if (!org) return null;

  const thesis = thesisRes.data as InvestmentThesis | null;
  const records = (recordsRes.data ?? []) as TrackRecord[];
  const entities = (entitiesRes.data ?? []) as Entity[];
  const members = (membersRes.data ?? []) as OrganizationMember[];
  const documents = (docsRes.data ?? []) as Document[];

  let principals: Principal[] = [];
  if (members.length) {
    const { data, error: principalsErr } = await supabase
      .from("principals")
      .select("*")
      .in("id", members.map((m) => m.principal_id));
    if (principalsErr) throw new DataRoomReadError("principals", principalsErr);
    principals = (data ?? []) as Principal[];
  }
  const byId = new Map(principals.map((p) => [p.id, p]));
  // People on the team with no login still belong on the fund's team page.
  const { data: profileRows } = await supabase
    .from("team_profiles")
    .select("full_name, title, email")
    .eq("organization_id", orgId)
    .order("created_at", { ascending: true });
  const profiles = (profileRows ?? []) as { full_name: string; title: string | null; email: string | null }[];
  const blended = blendTrackRecord(records);

  // Group published documents by section, in the order the room sets.
  const ordered = [...documents].sort(
    (a, b) =>
      (manifestOrder.get(a.id) ?? 0) - (manifestOrder.get(b.id) ?? 0) || a.name.localeCompare(b.name),
  );
  const docsBySection = new Map<string, ViewerDoc[]>();
  for (const d of ordered) {
    const k = roomSectionKey(d.doc_type);
    const locked = needsSignature.has(d.id) && !signed.has(d.id);
    const doc: ViewerDoc = locked
      ? {
          // Nothing of a locked file leaves the server: not its text, not where its bytes live, not even that it has a file.
          id: d.id,
          name: d.name,
          content: null,
          hasFile: false,
          doc_type: d.doc_type ?? null,
          preview_kind: "none",
          uploaded: false,
          requiresSignature: true,
          signed: false,
          // Nothing of a locked file leaves the server, and that includes when it
          // last changed: an unsigned reader must not learn a side letter was revised.
        }
      : {
      id: d.id,
      name: d.name,
      content: d.content ?? null,
      hasFile: Boolean(d.storage_key),
      doc_type: d.doc_type ?? null,
      preview_kind: previewKindFor(d.storage_key),
      uploaded: isUploadedFile(d.storage_key),
      ...(needsSignature.has(d.id) ? { requiresSignature: true, signed: true } : {}),
      ...changeInfo(d, addedToRoom.get(d.id), reader?.lastVisitAt),
    };
    const bucket = docsBySection.get(k);
    if (bucket) bucket.push(doc);
    else docsBySection.set(k, [doc]);
  }

  const docSections: ViewerSection[] = sectionsAllowedBy(
    // A document link is scoped by its document, never narrowed by sections.
    documentId ? null : allowedSections,
    DATA_ROOM_SECTIONS.map((s) => ({
      key: s.key,
      label: s.label,
      docs: docsBySection.get(s.key) ?? [],
    })).filter((s) => s.docs.length > 0),
  );

  // The firm's Build pages follow the link's section allowlist, as the documents
  // do. A single-document link shows its document and nothing else of the firm.
  const pages = documentId
    ? { thesis: false, trackRecord: false, team: false, structure: false }
    : buildPagesAllowedBy(allowedSections);

  // The room's headline and welcome note. A single-document link shows the
  // document alone, so it carries neither.
  let room: ViewerRoom = { name: "", welcomeNote: null };
  if (!documentId) {
    const { data: roomRow, error: roomErr } = await supabase
      .from("data_rooms")
      .select("name, welcome_note")
      .eq("id", roomId)
      .eq("organization_id", orgId)
      .maybeSingle();
    if (roomErr) throw new DataRoomReadError("room", roomErr);
    const r = roomRow as { name: string; welcome_note: string | null } | null;
    room = { name: r?.name ?? "", welcomeNote: r?.welcome_note?.trim() || null };
  }

  return {
    room,
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
    blended: pages.trackRecord
      ? {
          dealCount: blended.dealCount,
          realizedCount: blended.realizedCount,
          weightedGrossIrr: blended.weightedGrossIrr ?? null,
          pooledMoic: blended.pooledMoic ?? null,
          dpi: blended.dpi ?? null,
          totalInvested: blended.totalInvested ?? null,
          vintageRange: blended.vintageRange ?? null,
        }
      : {
          dealCount: 0,
          realizedCount: 0,
          weightedGrossIrr: null,
          pooledMoic: null,
          dpi: null,
          totalInvested: null,
          vintageRange: null,
        },
    thesis: thesis && pages.thesis
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
    team: !pages.team
      ? []
      : [
      ...members.map((m) => {
        const p = byId.get(m.principal_id);
        return {
          name: p?.full_name || p?.email || "Member",
          title: p?.title ?? null,
          email: p?.email ?? null,
        };
      }),
      ...profiles.map((t) => ({ name: t.full_name, title: t.title, email: t.email })),
    ],
    entities: !pages.structure
      ? []
      : entities.map((e) => ({
          name: e.name,
          entity_type: (e as { entity_type?: string | null }).entity_type ?? null,
        })),
    docSections,
  };
}
