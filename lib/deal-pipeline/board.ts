/**
 * lib/deal-pipeline/board.ts — pure view logic for the Deal pipeline board.
 *
 * Filtering, searching and sorting over the pipeline's deal cards, shared by
 * the grid and the kanban board views. Pure (no IO) so the choreography is
 * unit-testable; the component layer owns state and rendering.
 */

/** The card fields the board logic reads — a structural slice of PipelineDeal. */
export interface BoardDeal {
  id: string;
  name: string;
  note: string;
  stage: string;
  amount: number | null;
  fit: number;
}

export interface BoardFilters {
  /** Free-text search over name + note; empty matches everything. */
  query: string;
  /** Stage key to pin, or '' for all stages. */
  stage: string;
}

export type BoardSortKey = 'stage' | 'fit' | 'size' | 'name';

/** Sort options for the toolbar select, in display order. */
export const BOARD_SORTS: Array<{ key: BoardSortKey; label: string }> = [
  { key: 'stage', label: 'Furthest along' },
  { key: 'fit', label: 'Highest score' },
  { key: 'size', label: 'Largest size' },
  { key: 'name', label: 'Name A–Z' }
];

function matchesQuery(deal: BoardDeal, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return deal.name.toLowerCase().includes(q) || deal.note.toLowerCase().includes(q);
}

/** Apply the toolbar's search + stage filters. Returns a new array. */
export function filterDeals<T extends BoardDeal>(deals: T[], filters: BoardFilters): T[] {
  return deals.filter(
    (d) => (!filters.stage || d.stage === filters.stage) && matchesQuery(d, filters.query)
  );
}

/**
 * Sort the cards. 'stage' is the default board order: furthest stage first
 * (per `stageKeys`, the canonical stage order), then fit desc — matching the
 * prototype's grid. Unsized deals sort after sized ones under 'size'.
 */
export function sortDeals<T extends BoardDeal>(
  deals: T[],
  key: BoardSortKey,
  stageKeys: string[]
): T[] {
  const stageIdx = (d: BoardDeal) => stageKeys.indexOf(d.stage);
  const sorted = deals.slice();
  switch (key) {
    case 'fit':
      sorted.sort((a, b) => b.fit - a.fit || a.name.localeCompare(b.name));
      break;
    case 'size':
      sorted.sort((a, b) => (b.amount ?? -1) - (a.amount ?? -1) || a.name.localeCompare(b.name));
      break;
    case 'name':
      sorted.sort((a, b) => a.name.localeCompare(b.name));
      break;
    default:
      sorted.sort((a, b) => stageIdx(b) - stageIdx(a) || b.fit - a.fit);
  }
  return sorted;
}
