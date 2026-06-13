import type { InboxDealOption, InboxItem } from './channels';

/* ============================================================================
 * lib/inbox/suggest.ts — deal routing suggestion (pure, client-safe).
 *
 * When an operator accepts a conversation, we offer the deal it most likely
 * belongs to. There is no contact→deal foreign key to lean on, so the
 * suggestion is grounded in a transparent, explainable signal: meaningful
 * token overlap between the deal's name and the conversation's subject/preview.
 *
 * Honesty contract: we only ever return a suggestion when there is a real
 * lexical match. With no overlap we return null, and the UI shows the full
 * deal picker with nothing pre-selected rather than guessing.
 * ========================================================================= */

/** Tokens shorter than this, or pure stopwords, carry no routing signal. */
const MIN_TOKEN_LEN = 3;
const STOPWORDS = new Set([
  're',
  'fwd',
  'the',
  'and',
  'for',
  'with',
  'your',
  'you',
  'our',
  'call',
  'meeting',
  'inc',
  'llc',
  'ltd',
  'corp',
  'fund',
  'capital',
  'partners',
  'group'
]);

/** Lowercase alphanumeric tokens of meaningful length, stopwords removed. */
export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= MIN_TOKEN_LEN && !STOPWORDS.has(t));
}

export interface DealSuggestion {
  dealId: string;
  /** The overlapping tokens that justify the match — shown to the operator. */
  matched: string[];
}

/**
 * Suggest the deal an inbox item most likely routes to, or null when nothing
 * matches. Ranks deals by the count of distinct tokens their name shares with
 * the conversation's subject + preview; ties break toward the earlier deal
 * (callers pass deals newest-first, so that favors recent activity).
 */
export function suggestDeal(
  item: Pick<InboxItem, 'subject' | 'preview' | 'dealId'>,
  deals: InboxDealOption[]
): DealSuggestion | null {
  // An item already bound to a deal suggests itself.
  if (item.dealId && deals.some((d) => d.id === item.dealId)) {
    return { dealId: item.dealId, matched: [] };
  }

  const haystack = new Set(tokenize(`${item.subject} ${item.preview}`));
  if (haystack.size === 0) return null;

  let best: DealSuggestion | null = null;
  let bestScore = 0;
  for (const deal of deals) {
    const matched = [...new Set(tokenize(deal.name))].filter((t) => haystack.has(t));
    if (matched.length > bestScore) {
      bestScore = matched.length;
      best = { dealId: deal.id, matched };
    }
  }
  return best;
}
