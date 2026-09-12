// Server component for Documents › Library — the firm's document repository.
// It loads every document the org holds (drafts included), scores quality, and
// annotates each one with the rooms it has been published into, so the operator
// can see at a glance what is private and what an LP can reach.
import { redirect } from "next/navigation";
import Link from "next/link";
import { getSessionContext } from "@/lib/auth";
import { createServerClient } from "@/lib/supabase/server";
import { DATA_ROOM_SECTIONS } from "@/lib/data-room";
import { computeBuildReadiness } from "@/lib/build-readiness";
import { scoreDocument } from "@/lib/document-quality";
import { listRooms, publishedRoomsByDocument } from "@/lib/data-rooms.server";
import { ModuleHeader } from "@/components/build/DraftWithEarn";
import { SectionHighlighter } from "@/components/build/SectionHighlighter";
import { WorkspaceDocumentListLive } from "@/components/workspace/WorkspaceDocumentListLive";
import { documentKindLabel, formatBytes, isUploadedFile } from "@/lib/document-files";
import { relativeTime } from "@/lib/activity";
import { LibraryWorkspace } from "./LibraryWorkspace";
import type { LibraryDoc, LibrarySection } from "./LibraryControls";
import type {
  Organization,
  InvestmentThesis,
  TrackRecord,
  Entity,
  OrganizationMember,
  Principal,
  Document,
} from "@/lib/supabase/database.types";

// Sections Earn can draft from the Build foundation without a source file.
const AI_DRAFTABLE = new Set(["overview", "thesis", "marketing", "team", "track_record"]);

export async function DocumentsLibraryLive() {
  const ctx = await getSessionContext();
  if (!ctx?.orgId) redirect("/login");
  const orgId = ctx.orgId;
  const supabase = await createServerClient();

  const [orgRes, thesesRes, recordsRes, entitiesRes, membersRes, docsRes] = await Promise.all([
    supabase.from("organizations").select("*").eq("id", orgId).maybeSingle(),
    supabase
      .from("investment_theses")
      .select("*")
      .eq("organization_id", orgId)
      .order("is_active", { ascending: false })
      .order("created_at", { ascending: false }),
    supabase
      .from("track_records")
      .select("*")
      .eq("organization_id", orgId)
      .order("vintage_year", { ascending: false }),
    supabase.from("entities").select("*").eq("organization_id", orgId),
    supabase.from("organization_members").select("*").eq("organization_id", orgId),
    supabase
      .from("documents")
      .select("*")
      .eq("organization_id", orgId)
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: true }),
  ]);

  const documents = (docsRes.data ?? []) as Document[];
  const [rooms, publishedBy] = await Promise.all([
    listRooms(orgId),
    publishedRoomsByDocument(orgId),
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

  const docsBySection = new Map<string, Document[]>();
  for (const d of documents) {
    const k = d.doc_type ?? "other";
    const bucket = docsBySection.get(k);
    if (bucket) bucket.push(d);
    else docsBySection.set(k, [d]);
  }
  const docCounts: Record<string, number> = {};
  for (const [k, v] of docsBySection) docCounts[k] = v.length;

  const readiness = computeBuildReadiness({
    org: orgRes.data as Organization | null,
    theses: (thesesRes.data ?? []) as InvestmentThesis[],
    entities: (entitiesRes.data ?? []) as Entity[],
    records: (recordsRes.data ?? []) as TrackRecord[],
    members,
    principals,
    docCounts,
  });

  const now = new Date();
  const sections: LibrarySection[] = DATA_ROOM_SECTIONS.map((s) => {
    const docs: LibraryDoc[] = (docsBySection.get(s.key) ?? []).map((d) => {
      const q = d.content ? scoreDocument(d.name, d.doc_type ?? null, d.content) : null;
      // `updated_at` only exists from migration 20260912120000 onward; a row
      // written before it falls back to its creation time rather than showing
      // an empty column.
      const updatedAt = (d as { updated_at?: string | null }).updated_at ?? d.created_at;
      return {
        id: d.id,
        name: d.name,
        storageKey: d.storage_key ?? null,
        hasContent: Boolean(d.content),
        kind: documentKindLabel(d.storage_key, Boolean(d.content)),
        sizeBytes: d.size_bytes ?? null,
        uploaded: isUploadedFile(d.storage_key),
        status: d.status ?? "ready",
        qualityScore: q?.score ?? null,
        qualityLevel: q?.level ?? null,
        qualityGaps: q?.gaps.length ?? null,
        roomIds: publishedBy.get(d.id) ?? [],
        section: s.key,
        updatedAt,
        updatedLabel: relativeTime(updatedAt, now),
      };
    });
    const viaBuild =
      !!s.buildModule &&
      readiness.statuses[s.buildModule] !== undefined &&
      readiness.statuses[s.buildModule] !== "empty";
    return {
      key: s.key,
      label: s.label,
      description: s.description,
      docs,
      viaBuild,
      aiDraftable: AI_DRAFTABLE.has(s.key),
    };
  });

  const total = documents.length;
  const drafts = documents.filter((d) => (d.status ?? "ready") !== "ready").length;
  const files = documents.filter((d) => isUploadedFile(d.storage_key));
  const storedBytes = files.reduce((n, d) => n + (d.size_bytes ?? 0), 0);

  return (
    <div>
      <ModuleHeader
        title="Library"
        blurb="Every document your firm holds — created, uploaded, or linked. Nothing here is visible outside the firm until you publish it into a data room."
        module="documents"
      />

      {/* What the counters do NOT repeat is the point: the rail already carries
          the library's size and how much of it is published, so this line is
          only what the rail cannot say — what is unfinished, and how much the
          firm is actually storing. */}
      {total > 0 ? (
        <div className="mb-5 flex flex-wrap items-center gap-2">
          <Stat label="In progress" value={String(drafts)} tone={drafts > 0 ? "amber" : undefined} />
          {files.length > 0 ? (
            <Stat
              label={`file${files.length === 1 ? "" : "s"} · ${formatBytes(storedBytes)}`}
              value={String(files.length)}
            />
          ) : null}
        </div>
      ) : null}

      <SectionHighlighter />
      <LibraryWorkspace sections={sections} rooms={rooms.map((r) => ({ id: r.id, name: r.name }))} />

      {/* The knowledge-workspace view of the same library — recency and shape
          rather than filing. It used to sit on top of the data room; it belongs
          with the documents it lists. */}
      {total > 0 ? (
        <section className="mt-8 border-t border-line pt-8">
          <p className="mb-4 font-mono text-[11px] uppercase tracking-[0.16em] text-fg-muted">
            Knowledge Workspace
          </p>
          <WorkspaceDocumentListLive />
        </section>
      ) : null}
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: "gold" | "amber" }) {
  const cls =
    tone === "gold"
      ? "border-gold-500/40 text-gold-300"
      : tone === "amber"
        ? "border-amber-500/30 text-amber-400"
        : "border-line text-fg-secondary";
  return (
    <span className={`rounded-full border px-3 py-1 font-mono text-[11px] uppercase tracking-wider ${cls}`}>
      {value} {label}
    </span>
  );
}
