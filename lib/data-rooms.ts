// lib/data-rooms.ts
// A data room is a *sharing* surface, not a library. `documents` holds and
// creates everything the firm has; a room is a named, curated subset published
// for a specific audience — a raise, a co-invest, a lender — with its own links,
// gates, and analytics.
//
// Everything here is pure: it takes rows and returns view models, so the
// publish/coverage/exposure rules are testable without a database.
import { DATA_ROOM_SECTIONS, summarizeDataRoom, type DataRoomSummary } from "@/lib/data-room";
import type { ModuleStatus } from "@/lib/build-readiness";
import type { DocumentStatus } from "@/lib/supabase/database.types";

/** Name given to the room created for a firm that has none yet. */
export const DEFAULT_ROOM_NAME = "Primary Data Room";

/** A document as a room cares about it — identity, filing, and publish state. */
export interface RoomDocument {
  id: string;
  name: string;
  /** Data-room section key (the document's `doc_type`). */
  section: string;
  status: DocumentStatus;
  /** Position within its section inside this room. */
  sortOrder: number;
  storageKey: string | null;
  hasContent: boolean;
  /** Readers must sign this file before it opens. */
  requireSignature?: boolean;
  /** The owner has placed the signature blocks readers will sign on. */
  hasSignatureBlocks?: boolean;
}

export interface RoomSection {
  key: string;
  label: string;
  docs: RoomDocument[];
}

const SECTION_LABEL = new Map(DATA_ROOM_SECTIONS.map((s) => [s.key, s.label]));
const SECTION_INDEX = new Map(DATA_ROOM_SECTIONS.map((s, i) => [s.key, i]));

/**
 * The section a document is shown under. A missing or unrecognised `doc_type`
 * (a legacy row, an import) files under the catch-all, so the GP list, the
 * coverage count and the LP viewer all place the same document in the same
 * section instead of the viewer silently dropping what the GP can see.
 */
export function roomSectionKey(docType: string | null | undefined): string {
  return docType && SECTION_INDEX.has(docType) ? docType : "other";
}

/** Canonical label for a section key, falling back to the catch-all. */
export function sectionLabel(key: string | null): string {
  return SECTION_LABEL.get(key ?? "other") ?? SECTION_LABEL.get("other") ?? "Other Materials";
}

/**
 * Group a room's published documents into ordered sections. Sections follow the
 * canonical `DATA_ROOM_SECTIONS` order (an allocator reads a room top-down);
 * documents follow their per-room `sortOrder`, then name. Empty sections are
 * dropped — a room shows what it holds, not what it lacks.
 */
export function groupRoomDocuments(docs: RoomDocument[]): RoomSection[] {
  const bySection = new Map<string, RoomDocument[]>();
  for (const d of docs) {
    const key = roomSectionKey(d.section);
    const bucket = bySection.get(key);
    if (bucket) bucket.push(d);
    else bySection.set(key, [d]);
  }
  return DATA_ROOM_SECTIONS.map((s) => ({
    key: s.key,
    label: s.label,
    docs: (bySection.get(s.key) ?? []).sort(
      (a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name),
    ),
  })).filter((s) => s.docs.length > 0);
}

/**
 * Coverage for a room. Counts only what is *published here* — the whole point of
 * the split is that an unpublished draft sitting in Documents must not make a
 * room look complete. Build-backed sections still count, because the room's
 * branded sheet carries that data.
 */
export function summarizeRoom(
  buildStatuses: Record<string, ModuleStatus | undefined>,
  docs: RoomDocument[],
): DataRoomSummary {
  const counts: Record<string, number> = {};
  for (const d of docs) {
    const key = roomSectionKey(d.section);
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return summarizeDataRoom(buildStatuses, counts);
}

/**
 * Documents published into a room that are not finished. Publishing is an
 * explicit act, so this is never a blocker — it is the one thing a GP wants
 * flagged before they send the link.
 */
export function unfinishedPublications(docs: RoomDocument[]): RoomDocument[] {
  return docs.filter((d) => d.status !== "ready");
}

/**
 * Documents published into a room with nothing to show — no file link and no
 * written content. They render as a dead entry to a viewer.
 */
export function emptyPublications(docs: RoomDocument[]): RoomDocument[] {
  return docs.filter((d) => !d.storageKey && !d.hasContent);
}

export interface ShareLike {
  label: string | null;
  expires_at: string | null;
  revoked_at: string | null;
  allowed_sections: string[] | null;
}

export type ShareState = "active" | "expired" | "revoked";

export function shareState(share: ShareLike, now: number = Date.now()): ShareState {
  if (share.revoked_at) return "revoked";
  if (share.expires_at && new Date(share.expires_at).getTime() < now) return "expired";
  return "active";
}

/**
 * Narrow a set of sections by a link's allowlist.
 *
 * `null`/`undefined` means unrestricted — the link opens every published
 * section. An *empty array* means the opposite: it allows nothing. That
 * asymmetry is deliberate. An allowlist is a deny-by-default boundary, so a
 * row that somehow carries `[]` (a hand-written link, a bad import, a future
 * caller that forgets to coerce) must fail closed. Reading `[]` as "no
 * restriction" would turn a corrupt value into a full-room disclosure, and it
 * would disagree with the document route, which has always denied on `[]`.
 *
 * Generic over the section shape so the GP-side room list and the LP-facing
 * viewer both scope through this one rule: a preview that filters differently
 * from the live room is exactly the bug this function exists to prevent.
 */
export function sectionsAllowedBy<S extends { key: string }>(
  allowed: string[] | null | undefined,
  sections: S[],
): S[] {
  if (allowed === null || allowed === undefined) return sections;
  const set = new Set(allowed);
  return sections.filter((s) => set.has(s.key));
}

/**
 * The section each Build page belongs to, read from DATA_ROOM_SECTIONS (which names
 * the Build module behind a section) so the mapping lives in one place: the thesis
 * module's section, the track record's, the team's, and the entity module's, which
 * is "Legal & Structure".
 */
const sectionOfBuildModule = (module: string): string => {
  const found = DATA_ROOM_SECTIONS.find((s) => s.buildModule === module);
  if (!found) throw new Error(`No data room section is backed by the "${module}" Build module`);
  return found.key;
};
export const BUILD_PAGE_SECTION = {
  thesis: sectionOfBuildModule("thesis"),
  trackRecord: sectionOfBuildModule("track_record"),
  team: sectionOfBuildModule("team"),
  structure: sectionOfBuildModule("entity"),
} as const;

/**
 * Which of the firm's Build pages a link's section allowlist lets a reader see.
 *
 * Each page belongs to a section: the thesis page to "Investment Strategy &
 * Thesis", the track record to "Track Record & Performance", the team to "Team &
 * Governance", the structure to "Legal & Structure". A link that does not allow
 * the section does not show the page either. `null`/`undefined` is unrestricted,
 * and `[]` allows nothing, as in sectionsAllowedBy. The overview is the firm's
 * identity, not a section, so it is not governed here and always shows.
 */
export function buildPagesAllowedBy(allowed: string[] | null | undefined): {
  thesis: boolean;
  trackRecord: boolean;
  team: boolean;
  structure: boolean;
} {
  if (allowed === null || allowed === undefined) {
    return { thesis: true, trackRecord: true, team: true, structure: true };
  }
  const set = new Set(allowed);
  return {
    thesis: set.has(BUILD_PAGE_SECTION.thesis),
    trackRecord: set.has(BUILD_PAGE_SECTION.trackRecord),
    team: set.has(BUILD_PAGE_SECTION.team),
    structure: set.has(BUILD_PAGE_SECTION.structure),
  };
}

/**
 * What a link actually exposes: the room's published sections narrowed by the
 * link's own allowlist. `allowed_sections: null` means every published section.
 * Answers the question a GP asks before sending — "what does this person see?"
 */
export function shareExposure(share: ShareLike, sections: RoomSection[]): RoomSection[] {
  return sectionsAllowedBy(share.allowed_sections, sections);
}

/** Count of documents a link exposes. */
export function shareDocCount(share: ShareLike, sections: RoomSection[]): number {
  return shareExposure(share, sections).reduce((n, s) => n + s.docs.length, 0);
}

/** A page the reader sees that comes from Build, not from a published document. */
export interface BuildContentRow {
  key: "overview" | "thesis" | "track_record" | "team" | "structure";
  label: string;
  /** What it holds now, or what is missing. */
  detail: string;
  /** Nothing entered in Build yet, so a reader sees no such page or section. */
  empty: boolean;
  /** Where to edit it. */
  href: string;
  /** The entry a reader finds it under. */
  shownUnder: string;
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/**
 * The Build-sourced pages of a room, for the GP's Room contents. These are what
 * Preview as LP shows beyond the published documents. The thesis and track
 * record are always listed so a gap is visible; the rest only when they hold
 * something.
 */
export function buildContentRows(src: {
  tagline: string | null;
  thesisTitle: string | null;
  dealCount: number;
  weightedGrossIrr: number | null;
  teamCount: number;
  entityCount: number;
}): BuildContentRow[] {
  const rows: BuildContentRow[] = [
    {
      key: "overview",
      label: "Firm overview",
      detail: src.tagline || "From Firm Identity",
      empty: false,
      href: "/build/profile",
      shownUnder: "Overview",
    },
    {
      key: "thesis",
      label: "Investment thesis",
      detail: src.thesisTitle ?? "Not set up yet",
      empty: src.thesisTitle === null,
      href: "/build/thesis",
      shownUnder: sectionLabel(BUILD_PAGE_SECTION.thesis),
    },
    {
      key: "track_record",
      label: "Track record",
      detail:
        src.dealCount > 0
          ? [
              plural(src.dealCount, "deal", "deals"),
              src.weightedGrossIrr != null ? `${src.weightedGrossIrr.toFixed(0)}% gross IRR` : null,
            ]
              .filter(Boolean)
              .join(" · ")
          : "No deals entered yet",
      empty: src.dealCount === 0,
      href: "/build/track_record",
      shownUnder: sectionLabel(BUILD_PAGE_SECTION.trackRecord),
    },
  ];
  if (src.teamCount > 0) {
    rows.push({
      key: "team",
      label: "Team",
      detail: plural(src.teamCount, "person", "people"),
      empty: false,
      href: "/build/team",
      shownUnder: "Team",
    });
  }
  if (src.entityCount > 0) {
    rows.push({
      key: "structure",
      label: "Structure",
      detail: plural(src.entityCount, "entity", "entities"),
      empty: false,
      href: "/build/entity",
      shownUnder: "Structure",
    });
  }
  return rows;
}
