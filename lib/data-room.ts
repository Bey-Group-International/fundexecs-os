// lib/data-room.ts
// The Materials & Data Room is the single place a firm assembles everything it
// shows the private capital market at large — LPs, co-investors, lenders, and
// partners. This defines the standard data-room sections and a pure helper that
// scores coverage from the firm's Build foundation plus any uploaded materials.
import type { ModuleStatus } from "@/lib/build-readiness";

export interface DataRoomSection {
  key: string;
  label: string;
  description: string;
  /** When set, the section is also satisfied by Build foundation data. */
  buildModule?: "profile" | "thesis" | "track_record" | "team" | "entity";
  /** Excluded from the completeness checklist (catch-all), still in the library. */
  catchAll?: boolean;
}

// `key` doubles as the document's doc_type, so the add form and the grouped
// library agree on categories.
export const DATA_ROOM_SECTIONS: DataRoomSection[] = [
  { key: "overview", label: "Overview", description: "Firm profile, positioning, and summary.", buildModule: "profile" },
  { key: "thesis", label: "Thesis & Strategy", description: "Mandate, strategy, and target returns.", buildModule: "thesis" },
  { key: "track_record", label: "Track Record", description: "Prior deals and realized performance.", buildModule: "track_record" },
  { key: "team", label: "Team", description: "Principals, bios, and org.", buildModule: "team" },
  { key: "legal", label: "Legal & Structure", description: "Entities, formation docs, and agreements.", buildModule: "entity" },
  { key: "financials", label: "Financials", description: "Statements, models, and projections." },
  { key: "diligence", label: "Diligence / DDQ", description: "Due-diligence questionnaires and responses." },
  { key: "references", label: "References", description: "References and prior counterparties." },
  { key: "other", label: "Other Materials", description: "Anything else worth sharing.", catchAll: true },
];

export interface ChecklistItem {
  key: string;
  label: string;
  description: string;
  ready: boolean;
  docCount: number;
  /** True when satisfied by Build data rather than (or in addition to) a doc. */
  viaBuild: boolean;
}

export interface DataRoomSummary {
  items: ChecklistItem[];
  readyCount: number;
  total: number;
  percent: number;
}

/**
 * Score data-room coverage. A section counts as ready when it has at least one
 * document, or — for Build-backed sections — when its Build module holds data.
 * Pure: takes the Build module statuses and per-section document counts.
 */
export function summarizeDataRoom(
  buildStatuses: Record<string, ModuleStatus | undefined>,
  docCounts: Record<string, number>,
): DataRoomSummary {
  const checklistSections = DATA_ROOM_SECTIONS.filter((s) => !s.catchAll);
  const items: ChecklistItem[] = checklistSections.map((s) => {
    const docCount = docCounts[s.key] ?? 0;
    const viaBuild = !!s.buildModule && buildStatuses[s.buildModule] !== undefined && buildStatuses[s.buildModule] !== "empty";
    return {
      key: s.key,
      label: s.label,
      description: s.description,
      ready: viaBuild || docCount > 0,
      docCount,
      viaBuild,
    };
  });
  const readyCount = items.filter((i) => i.ready).length;
  const total = items.length;
  const percent = total === 0 ? 0 : Math.round((readyCount / total) * 100);
  return { items, readyCount, total, percent };
}
