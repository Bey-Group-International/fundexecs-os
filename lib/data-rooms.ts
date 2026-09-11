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
}

export interface RoomSection {
  key: string;
  label: string;
  docs: RoomDocument[];
}

const SECTION_LABEL = new Map(DATA_ROOM_SECTIONS.map((s) => [s.key, s.label]));
const SECTION_INDEX = new Map(DATA_ROOM_SECTIONS.map((s, i) => [s.key, i]));

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
    const key = SECTION_INDEX.has(d.section) ? d.section : "other";
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
    const key = SECTION_INDEX.has(d.section) ? d.section : "other";
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
 * Narrow a set of sections by an allowlist. `null` or empty means no
 * restriction — every section passes.
 *
 * Generic over the section shape so the GP-side room list and the LP-facing
 * viewer both scope through this one rule: a preview that filters differently
 * from the live room is exactly the bug this page exists to prevent.
 */
export function sectionsAllowedBy<S extends { key: string }>(
  allowed: string[] | null | undefined,
  sections: S[],
): S[] {
  if (!allowed || allowed.length === 0) return sections;
  const set = new Set(allowed);
  return sections.filter((s) => set.has(s.key));
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
