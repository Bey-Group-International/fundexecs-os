// lib/diligence-templates.ts
// Pure, DB-free logic for the Run › Diligence module: the standard private-markets
// DD checklist templates plus the grouping / coverage / overdue math the UI and
// server actions lean on. Everything here is deterministic and unit-tested in
// lib/diligence-templates.test.ts — keep it side-effect free.
import type { DiligenceItem, DiligenceStatus } from "@/lib/supabase/database.types";

// --- Checklist templates ----------------------------------------------------
// Standard diligence categories for a private-markets deal. Each carries a
// sensible default list of item titles an operator would expect to see on a
// fresh checklist. `applyDiligenceTemplate` materialises these as open items.
export const DILIGENCE_CATEGORIES = [
  "legal",
  "financial",
  "commercial",
  "tax",
  "operational",
  "environmental",
] as const;

export type DiligenceCategory = (typeof DILIGENCE_CATEGORIES)[number];

export const DILIGENCE_TEMPLATES: Record<DiligenceCategory, readonly string[]> = {
  legal: [
    "Corporate structure & cap table review",
    "Material contracts review",
    "Litigation & disputes search",
    "Regulatory licences & permits",
    "Intellectual property ownership",
    "Change-of-control / consent provisions",
  ],
  financial: [
    "Quality of earnings analysis",
    "Historical financial statements review",
    "Working capital normalisation",
    "Net debt & debt-like items",
    "Revenue recognition policies",
    "Management accounts vs. audited reconciliation",
  ],
  commercial: [
    "Market sizing & growth thesis",
    "Customer concentration analysis",
    "Competitive positioning review",
    "Pricing & unit economics",
    "Sales pipeline & retention",
    "Management reference calls",
  ],
  tax: [
    "Corporate tax compliance history",
    "VAT / sales tax review",
    "Transfer pricing review",
    "Tax structuring of acquisition",
    "Historical tax exposures & reserves",
  ],
  operational: [
    "Organisational design & key personnel",
    "IT systems & cybersecurity review",
    "Supply chain & vendor dependencies",
    "Operational KPIs & capacity",
    "Insurance coverage review",
  ],
  environmental: [
    "Phase I environmental site assessment",
    "ESG policy & disclosures review",
    "Health & safety compliance",
    "Climate / transition risk exposure",
    "Permits & environmental liabilities",
  ],
};

/** Is the given string one of the known template categories? */
export function isDiligenceCategory(value: string): value is DiligenceCategory {
  return (DILIGENCE_CATEGORIES as readonly string[]).includes(value);
}

/**
 * Resolve the template titles for a category, or for every category when
 * passed "all". Returns a flat list of `{ category, title }` rows ready to be
 * inserted as diligence_items. Unknown categories yield an empty list.
 */
export function templateItemsFor(
  category: DiligenceCategory | "all",
): { category: DiligenceCategory; title: string }[] {
  const cats: DiligenceCategory[] =
    category === "all" ? [...DILIGENCE_CATEGORIES] : isDiligenceCategory(category) ? [category] : [];
  return cats.flatMap((c) => DILIGENCE_TEMPLATES[c].map((title) => ({ category: c, title })));
}

/**
 * Given the template rows for a deal and the titles that already exist on it,
 * return only the rows whose (normalised) title is not already present — so
 * applying a template twice is idempotent. Matching is case-insensitive and
 * whitespace-trimmed.
 */
export function newTemplateItems(
  rows: { category: DiligenceCategory; title: string }[],
  existingTitles: Iterable<string>,
): { category: DiligenceCategory; title: string }[] {
  const have = new Set<string>();
  for (const t of existingTitles) have.add(t.trim().toLowerCase());
  return rows.filter((r) => !have.has(r.title.trim().toLowerCase()));
}

// --- Coverage ---------------------------------------------------------------
const RESOLVED_STATUSES: ReadonlySet<DiligenceStatus> = new Set<DiligenceStatus>(["cleared", "waived"]);

/** An item counts as "covered" once it's cleared or waived. */
export function isResolved(item: Pick<DiligenceItem, "status">): boolean {
  return RESOLVED_STATUSES.has(item.status);
}

export interface CategoryCoverage {
  category: string;
  total: number;
  resolved: number;
  /** resolved / total in [0,1]; 0 when there are no items. */
  ratio: number;
}

/**
 * Group items by category and report coverage (resolved / total) per category.
 * Sorted by category name for stable rendering.
 */
export function coverageByCategory(items: DiligenceItem[]): CategoryCoverage[] {
  const byCat = new Map<string, { total: number; resolved: number }>();
  for (const it of items) {
    const key = it.category || "general";
    const bucket = byCat.get(key) ?? { total: 0, resolved: 0 };
    bucket.total += 1;
    if (isResolved(it)) bucket.resolved += 1;
    byCat.set(key, bucket);
  }
  return [...byCat.entries()]
    .map(([category, { total, resolved }]) => ({
      category,
      total,
      resolved,
      ratio: total === 0 ? 0 : resolved / total,
    }))
    .sort((a, b) => a.category.localeCompare(b.category));
}

// --- Grouping by deal -------------------------------------------------------
export interface DealGroup {
  dealId: string;
  items: DiligenceItem[];
  total: number;
  resolved: number;
  /** resolved / total in [0,1]; 0 when the group is empty. */
  progress: number;
}

/**
 * Group items by deal, preserving the incoming item order within each group and
 * ordering groups by first appearance. Each group carries cleared+waived
 * progress for the per-deal indicator.
 */
export function groupByDeal(items: DiligenceItem[]): DealGroup[] {
  const order: string[] = [];
  const byDeal = new Map<string, DiligenceItem[]>();
  for (const it of items) {
    if (!byDeal.has(it.deal_id)) {
      byDeal.set(it.deal_id, []);
      order.push(it.deal_id);
    }
    byDeal.get(it.deal_id)!.push(it);
  }
  return order.map((dealId) => {
    const groupItems = byDeal.get(dealId)!;
    const resolved = groupItems.filter(isResolved).length;
    const total = groupItems.length;
    return { dealId, items: groupItems, total, resolved, progress: total === 0 ? 0 : resolved / total };
  });
}

// --- Open-items rollup ------------------------------------------------------
/** Count of items that are not yet resolved (cleared/waived). */
export function openCount(items: DiligenceItem[]): number {
  return items.filter((it) => !isResolved(it)).length;
}

// --- Overdue ----------------------------------------------------------------
/**
 * An item is overdue when it has a due_date strictly before `today`, and it is
 * still open (not resolved). `today` is an ISO date (YYYY-MM-DD); comparison is
 * lexicographic, which is correct for zero-padded ISO dates.
 */
export function isOverdue(
  item: Pick<DiligenceItem, "due_date" | "status">,
  today: string,
): boolean {
  if (!item.due_date) return false;
  if (isResolved(item)) return false;
  return item.due_date < today;
}

/** Number of open items past their due date as of `today`. */
export function overdueCount(items: DiligenceItem[], today: string): number {
  return items.filter((it) => isOverdue(it, today)).length;
}
