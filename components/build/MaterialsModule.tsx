import { redirect } from "next/navigation";
import Link from "next/link";
import { getSessionContext } from "@/lib/auth";
import { createServerClient } from "@/lib/supabase/server";
import type {
  Document,
  DataRoomShare,
  Organization,
  InvestmentThesis,
  TrackRecord,
  Entity,
  OrganizationMember,
  Principal,
} from "@/lib/supabase/database.types";
import { computeBuildReadiness } from "@/lib/build-readiness";
import {
  sectionLabel,
  groupRoomDocuments,
  summarizeRoom,
  unfinishedPublications,
  emptyPublications,
} from "@/lib/data-rooms";
import { listRooms, pickRoom, loadRoomDocuments } from "@/lib/data-rooms.server";
import { buildViewerPayload } from "@/lib/data-room-viewer.server";
import { RoomPreview, type PreviewShare } from "./RoomPreview";
import { ShareControls } from "./ShareControls";
import { ViewerAnalytics } from "./ViewerAnalytics";
import { NdaSignatures } from "./NdaSignatures";
import { AuditExport } from "./AuditExport";
import { RoomSwitcher } from "./RoomSwitcher";
import { RoomWorkspace } from "./RoomWorkspace";
import type { RoomContentSection, AvailableDoc } from "./RoomContents";

// Materials & Data Room — the firm's institutional sharing surface, shaped like
// the virtual data rooms allocators work in: an index rail that is always
// visible, and one pane that switches between curating, sharing, reading
// activity, and seeing the room as a recipient does.
//
// Documents are held and created in Documents (/build/documents) and reach a
// room only by an explicit publish. Nothing on this page creates or edits a
// document.
export async function MaterialsModule({ roomId }: { roomId?: string } = {}) {
  const ctx = await getSessionContext();
  if (!ctx?.orgId) redirect("/login");
  const orgId = ctx.orgId;
  const supabase = await createServerClient();

  const rooms = await listRooms(orgId);
  const room = pickRoom(rooms, roomId);

  if (!room) {
    return (
      <div>
        <Header />
        <p className="text-sm text-fg-secondary">
          Couldn&apos;t load your data rooms. Refresh, or{" "}
          <Link href="/build/documents" className="text-gold-300 hover:underline">
            start in Documents
          </Link>
          .
        </p>
      </div>
    );
  }

  const [published, libraryRes, sharesRes, payload] = await Promise.all([
    loadRoomDocuments(orgId, room.id),
    supabase
      .from("documents")
      .select("*")
      .eq("organization_id", orgId)
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: true }),
    supabase
      .from("data_room_shares")
      .select("*")
      .eq("organization_id", orgId)
      .eq("room_id", room.id)
      .order("created_at", { ascending: false }),
    // The preview is built by the same function the live room uses, with no
    // section allowlist — the widest view any link into this room can give.
    buildViewerPayload(supabase, orgId, room.id, null),
  ]);

  const libraryDocs = (libraryRes.data ?? []) as Document[];
  const shares = (sharesRes.data ?? []) as DataRoomShare[];
  const publishedIds = new Set(published.map((d) => d.id));
  const roomSections = groupRoomDocuments(published);

  // Coverage counts the whole library for Build-readiness, but room coverage is
  // scored against what is published here — an unpublished draft must never
  // make a room look complete.
  const docCounts: Record<string, number> = {};
  for (const d of libraryDocs) {
    const k = d.doc_type ?? "other";
    docCounts[k] = (docCounts[k] ?? 0) + 1;
  }
  const [orgRes, thesesRes, recordsRes, entitiesRes, membersRes] = await Promise.all([
    supabase.from("organizations").select("*").eq("id", orgId).maybeSingle(),
    supabase.from("investment_theses").select("*").eq("organization_id", orgId),
    supabase.from("track_records").select("*").eq("organization_id", orgId),
    supabase.from("entities").select("*").eq("organization_id", orgId),
    supabase.from("organization_members").select("*").eq("organization_id", orgId),
  ]);
  const members = (membersRes.data ?? []) as OrganizationMember[];
  let principals: Principal[] = [];
  if (members.length) {
    const { data } = await supabase
      .from("principals")
      .select("*")
      .in("id", members.map((m) => m.principal_id));
    principals = (data ?? []) as Principal[];
  }
  const readiness = computeBuildReadiness({
    org: orgRes.data as Organization | null,
    theses: (thesesRes.data ?? []) as InvestmentThesis[],
    entities: (entitiesRes.data ?? []) as Entity[],
    records: (recordsRes.data ?? []) as TrackRecord[],
    members,
    principals,
    docCounts,
  });
  const summary = summarizeRoom(readiness.statuses, published);

  const unfinished = unfinishedPublications(published);
  const empty = emptyPublications(published);

  const contentSections: RoomContentSection[] = roomSections.map((s) => ({
    key: s.key,
    label: s.label,
    docs: s.docs.map((d) => ({
      id: d.id,
      name: d.name,
      status: d.status,
      hasBody: Boolean(d.storageKey) || d.hasContent,
      isLink: Boolean(d.storageKey),
    })),
  }));

  const available: AvailableDoc[] = libraryDocs
    .filter((d) => !publishedIds.has(d.id))
    .map((d) => ({
      id: d.id,
      name: d.name,
      sectionLabel: sectionLabel(d.doc_type),
      status: d.status ?? "ready",
    }));

  const liveShares = shares.filter(
    (s) => !s.revoked_at && !(s.expires_at && new Date(s.expires_at).getTime() < Date.now()),
  );
  const activeShareCount = liveShares.length;

  // Only live links are worth previewing — a revoked or expired one shows
  // nobody anything.
  const previewShares: PreviewShare[] = liveShares.map((s) => ({
    id: s.id,
    label: s.label,
    allowedSections: s.allowed_sections ?? null,
    gates: [
      s.require_email ? "email" : null,
      s.require_nda ? "NDA" : null,
      s.password_hash ? "password" : null,
    ].filter((g): g is string => g !== null),
  }));

  return (
    <div>
      <Header />

      <RoomSwitcher
        rooms={rooms.map((r) => ({
          id: r.id,
          name: r.name,
          description: r.description,
          isDefault: r.is_default,
        }))}
        current={{
          id: room.id,
          name: room.name,
          description: room.description,
          isDefault: room.is_default,
        }}
      />

      <RoomWorkspace
        roomId={room.id}
        roomName={room.name}
        roomDescription={room.description}
        sections={contentSections}
        available={available}
        warnings={{
          unfinished: unfinished.map((d) => d.id),
          empty: empty.map((d) => d.id),
        }}
        coverage={{
          weightedPercent: summary.weightedPercent,
          readyCount: summary.readyCount,
          total: summary.total,
        }}
        activeLinkCount={activeShareCount}
        nextGap={summary.suggestions[0]?.suggestion ?? null}
        sharing={
          <ShareControls
            roomId={room.id}
            roomName={room.name}
            publishedSections={roomSections.map((s) => ({
              key: s.key,
              label: s.label,
              count: s.docs.length,
            }))}
            shares={shares.map((s) => ({
              id: s.id,
              token: s.token,
              label: s.label,
              expires_at: s.expires_at,
              revoked_at: s.revoked_at,
              created_at: s.created_at,
              allowed_sections: s.allowed_sections ?? null,
            }))}
            activeCount={activeShareCount}
          />
        }
        activity={
          <div className="space-y-6">
            <AuditExport roomId={room.id} roomName={room.name} />
            <ViewerAnalytics roomId={room.id} />
            <NdaSignatures roomId={room.id} />
          </div>
        }
        preview={
          payload ? (
            <RoomPreview
              org={payload.org}
              blended={payload.blended}
              thesis={payload.thesis}
              team={payload.team}
              entities={payload.entities}
              docSections={payload.docSections}
              shares={previewShares}
            />
          ) : (
            <div className="flex h-full items-center justify-center px-6 text-center">
              <p className="text-sm text-fg-muted">Preview unavailable.</p>
            </div>
          )
        }
      />
    </div>
  );
}

function Header() {
  return (
    <div className="mb-6">
      <h2 className="font-display text-2xl font-semibold tracking-tight text-fg-primary">
        Materials &amp; Data Room
      </h2>
      <p className="mt-1 text-sm text-fg-secondary">
        Curated rooms you share with LPs, lenders, and partners. Documents are created in{" "}
        <Link href="/build/documents" className="text-gold-300 hover:underline">
          Documents
        </Link>{" "}
        and appear here only when you publish them.
      </p>
    </div>
  );
}
