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
  /** Relative importance for weighted coverage + next-best suggestions. */
  weight?: number;
  /** Imperative phrasing used when this section is the next-best to fill. */
  suggestion?: string;
}

// `key` doubles as the document's doc_type, so the add form and the grouped
// library agree on categories. The taxonomy mirrors an institutional fund data
// room — the sections an allocator's ODD/IDD team expects before committing —
// so coverage scoring pushes operators toward institution-ready materials.
export const DATA_ROOM_SECTIONS: DataRoomSection[] = [
  { key: "overview", label: "Firm Overview", description: "Firm summary, history, and positioning.", buildModule: "profile", weight: 2, suggestion: "Add a firm overview / summary deck." },
  { key: "marketing", label: "Marketing & Materials", description: "Executive summary, investor deck, one-pager, and teasers.", weight: 2, suggestion: "Add core materials — executive summary, investor deck, one-pager." },
  { key: "thesis", label: "Investment Strategy & Thesis", description: "Mandate, strategy, edge, and target returns.", buildModule: "thesis", weight: 3, suggestion: "Add your strategy / thesis materials." },
  { key: "track_record", label: "Track Record & Performance", description: "Realized/unrealized performance, attribution, and benchmarks.", buildModule: "track_record", weight: 3, suggestion: "Add a track-record / performance summary." },
  { key: "portfolio", label: "Portfolio & Case Studies", description: "Holdings, marks, and representative deal case studies.", weight: 2, suggestion: "Add portfolio case studies." },
  { key: "team", label: "Team & Governance", description: "Principals, bios, org chart, and decision governance.", buildModule: "team", weight: 2, suggestion: "Add team bios and governance." },
  { key: "fund_terms", label: "Fund Terms", description: "PPM, LPA, fees & carry, key terms, and side letters.", weight: 3, suggestion: "Add fund terms — PPM / LPA / fee schedule." },
  { key: "legal", label: "Legal & Structure", description: "Entities, formation, and material agreements.", buildModule: "entity", weight: 2, suggestion: "Add legal / structure documents." },
  { key: "financials", label: "Financials & Audits", description: "Audited financials, NAV, and management-company accounts.", weight: 2, suggestion: "Add audited financials." },
  { key: "compliance", label: "Compliance & Regulatory", description: "Form ADV, AML/KYC, and compliance policies.", weight: 2, suggestion: "Add compliance & regulatory filings." },
  { key: "operations", label: "Operations & Service Providers", description: "Fund admin, audit, legal, custody, and ODD pack.", weight: 1, suggestion: "Add operations / service-provider details (ODD)." },
  { key: "esg", label: "ESG & Responsible Investing", description: "ESG policy, reporting, and diligence approach.", weight: 1, suggestion: "Add your ESG / responsible-investing policy." },
  { key: "risk", label: "Risk Management", description: "Risk framework, valuation policy, and controls.", weight: 1, suggestion: "Add your risk-management framework." },
  { key: "diligence", label: "Diligence / DDQ", description: "ILPA DDQ and due-diligence responses.", weight: 2, suggestion: "Add a completed DDQ (ILPA)." },
  { key: "references", label: "References", description: "LP, portfolio, and counterparty references.", weight: 1, suggestion: "Add references." },
  { key: "other", label: "Other Materials", description: "Anything else worth sharing.", catchAll: true },
];

export interface KeyMaterial {
  name: string;
  /** Section (doc_type) the material is filed under. */
  section: string;
  /** Match aliases (lowercased) used to detect an existing document. */
  aliases: string[];
}

// The core fundraising collateral an institutional room is expected to carry.
// Surfaced as one-click presets that prefill the create form and show whether
// the material is already present.
export const KEY_MATERIALS: KeyMaterial[] = [
  { name: "Executive Summary", section: "marketing", aliases: ["executive summary", "exec summary"] },
  { name: "Investor Deck", section: "marketing", aliases: ["investor deck", "pitch deck", "deck"] },
  { name: "One-Pager", section: "marketing", aliases: ["one-pager", "one pager", "onepager", "tear sheet", "tearsheet"] },
  { name: "Teaser", section: "marketing", aliases: ["teaser"] },
  { name: "Fact Sheet", section: "marketing", aliases: ["fact sheet", "factsheet"] },
];

/** Match a key material against existing document names (case-insensitive). */
export function hasMaterial(material: KeyMaterial, docNames: string[]): boolean {
  const names = docNames.map((n) => n.toLowerCase());
  return names.some((n) => material.aliases.some((a) => n.includes(a)));
}

export interface ChecklistItem {
  key: string;
  label: string;
  description: string;
  ready: boolean;
  docCount: number;
  weight: number;
  /** Imperative next step when this section is missing. */
  suggestion: string;
  /** True when satisfied by Build data rather than (or in addition to) a doc. */
  viaBuild: boolean;
}

export interface DataRoomSummary {
  items: ChecklistItem[];
  readyCount: number;
  total: number;
  /** Count-based completeness. */
  percent: number;
  /** Weighted completeness — heavier sections (thesis, track record) count more. */
  weightedPercent: number;
  /** Missing sections, highest-weight first — the next-best things to add. */
  suggestions: ChecklistItem[];
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
      weight: s.weight ?? 1,
      suggestion: s.suggestion ?? `Add ${s.label.toLowerCase()} materials.`,
      viaBuild,
    };
  });
  const readyCount = items.filter((i) => i.ready).length;
  const total = items.length;
  const percent = total === 0 ? 0 : Math.round((readyCount / total) * 100);

  const totalWeight = items.reduce((s, i) => s + i.weight, 0);
  const readyWeight = items.reduce((s, i) => s + (i.ready ? i.weight : 0), 0);
  const weightedPercent = totalWeight === 0 ? 0 : Math.round((readyWeight / totalWeight) * 100);

  const suggestions = items
    .filter((i) => !i.ready)
    .sort((a, b) => b.weight - a.weight);

  return { items, readyCount, total, percent, weightedPercent, suggestions };
}
