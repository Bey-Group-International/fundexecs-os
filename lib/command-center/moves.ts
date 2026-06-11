import { HUB_META, type HubId } from '@/lib/hubs/lifecycle';
import { compactMoney } from '@/lib/format';

/* ============================================================================
 * lib/command-center/moves.ts — the cockpit's pure brain, ported from the
 * prototype's Command Center: ONE ranked highest-impact move (the hero),
 * then the queue "in order", then the overnight-style signal grid. All of
 * it derived from real desk state — every CTA navigates to the live surface
 * where the real approve loop runs; nothing here fakes an execution.
 * ========================================================================= */

export type MoveTone = 'gold' | 'azure' | 'success' | 'warning' | 'info' | 'neutral';

export interface DeskMove {
  id: string;
  hub: HubId;
  /** Short badge text on the hero header band ("First capital", …). */
  tag: string;
  tone: MoveTone;
  /** Icon name resolved via MandateIcon. */
  icon: string;
  title: string;
  why: string;
  /** Attribution line — which specialist owns this lane. */
  specialist: string;
  primary: { label: string; href: string };
  secondary: { label: string; href: string };
  /** Earn's first-person note (rendered on the hero only). */
  earnNote: string;
}

export interface DeskSignal {
  id: string;
  icon: string;
  tone: MoveTone;
  label: string;
  cta: string;
  href: string;
}

export interface DeskState {
  activeDealsCount: number;
  capitalInMotion: number;
  hotRelationshipsCount: number;
  recentDeals: ReadonlyArray<{ id: string; name: string; amount: number | null }>;
  topWarmConnections: ReadonlyArray<{
    id: string;
    name: string;
    company: string | null;
    status: string;
  }>;
  /** Per-hub readiness, as the rail shows it. */
  pct: Record<HubId, number>;
  /** Mandate objective (raise / launch / …), when set. */
  objective: string | null;
}

const MAX_MOVES = 4;

function hubHref(id: HubId): string {
  return HUB_META.find((m) => m.id === id)?.href ?? `/${id}`;
}

function hubLabel(id: HubId): string {
  return HUB_META.find((m) => m.id === id)?.label ?? id;
}

/**
 * Rank the desk's next moves. The first entry is the "Right now" hero; the
 * rest render as the ordered queue. Deterministic and side-effect free —
 * the same state always produces the same plan.
 */
export function deriveMoves(state: DeskState): DeskMove[] {
  const moves: DeskMove[] = [];

  if (state.activeDealsCount === 0) {
    moves.push({
      id: 'first-deal',
      hub: 'source',
      tag: 'Open the funnel',
      tone: 'azure',
      icon: 'radar',
      title: 'Put your first deal on the desk',
      why: 'The pipeline is empty, so nothing downstream can move. Add the first opportunity and Marcus scores it against your mandate the moment it lands.',
      specialist: 'Marcus · Dealflow',
      primary: { label: 'Open the pipeline', href: '/source/pipeline' },
      secondary: { label: 'Open Source', href: hubHref('source') },
      earnNote:
        'The desk runs on flow. Give me one real name and the committee, the closings room, and the record all come alive behind it.'
    });
  }

  if (state.hotRelationshipsCount === 0 && state.topWarmConnections.length === 0) {
    moves.push({
      id: 'lp-targets',
      hub: 'source',
      tag: 'First capital',
      tone: 'gold',
      icon: 'landmark',
      title: 'Build your LP target list',
      why: 'No relationships are tracked yet. Sloane drafts the target list from your mandate; every conversation after that lands on the Capital Map with a stage.',
      specialist: 'Sloane · Capital',
      primary: { label: 'Open the Capital Map', href: '/source/capital-map' },
      secondary: { label: 'Open Source', href: hubHref('source') },
      earnNote:
        'Raises are won in the map stage — who, in what order, with which story. I’ll keep every name staged and honest.'
    });
  } else if (state.hotRelationshipsCount === 0) {
    moves.push({
      id: 'warm-top',
      hub: 'source',
      tag: 'Momentum',
      tone: 'warning',
      icon: 'flame',
      title: 'Warm your top connections',
      why: 'You have relationships tracked but none are hot. Working the warmest two or three is the highest-leverage hour this week.',
      specialist: 'Sloane · Capital',
      primary: { label: 'Open the Capital Map', href: '/source/capital-map' },
      secondary: { label: 'Request an intro', href: '/source/partners' },
      earnNote:
        'Warmth decays — the map shows who is closest to a yes right now, and I’ll draft the next touch for each.'
    });
  }

  if (
    state.activeDealsCount > 0 &&
    state.capitalInMotion > 0 &&
    (state.objective === 'raise' || state.objective === 'launch') &&
    state.hotRelationshipsCount > 0
  ) {
    moves.push({
      id: 'keep-raise-moving',
      hub: 'execute',
      tag: 'In motion',
      tone: 'success',
      icon: 'banknote',
      title: `Keep the raise moving — ${compactMoney(state.capitalInMotion)} in motion`,
      why: `${state.hotRelationshipsCount} hot relationship${state.hotRelationshipsCount === 1 ? '' : 's'} and live capital in motion. Conversations cool fast — convert interest into commitments while momentum is real.`,
      specialist: 'Sloane · Capital',
      primary: { label: 'Open Closings', href: '/execute/closings' },
      secondary: { label: 'Open the Capital Map', href: '/source/capital-map' },
      earnNote:
        'Soft-circles become signatures in the closings room. I hold the step sequence; you approve each move.'
    });
  }

  if (state.activeDealsCount > 0) {
    moves.push({
      id: 'run-diligence',
      hub: 'run',
      tag: 'Committee',
      tone: 'info',
      icon: 'cpu',
      title: 'Put a deal through the committee',
      why: 'Active deals are sitting without a verdict. A seven-agent review turns an open question into a conviction score you can act on.',
      specialist: 'Theodore · Strategy',
      primary: { label: 'Open Diligence', href: '/run/diligence' },
      secondary: { label: 'Open the pipeline', href: '/source/pipeline' },
      earnNote:
        'Upload the deck and the committee reads it — six analysts, one synthesis, every claim cited.'
    });
  }

  // The thinnest layer, always present — the prototype's fallback move.
  const hubs = Object.keys(state.pct) as HubId[];
  const thinnest = hubs.slice().sort((a, b) => state.pct[a] - state.pct[b])[0];
  if (thinnest && !moves.some((m) => m.hub === thinnest)) {
    moves.push({
      id: `advance-${thinnest}`,
      hub: thinnest,
      tag: 'Keep momentum',
      tone: 'azure',
      icon: HUB_META.find((m) => m.id === thinnest)?.icon ?? 'route',
      title: `Advance ${hubLabel(thinnest)} — your thinnest layer`,
      why: `${hubLabel(thinnest)} is ${state.pct[thinnest]}% ready. The next step is staged inside the hub; open it and the team takes it from there.`,
      specialist: 'Earn · Chief of Staff',
      primary: { label: `Open ${hubLabel(thinnest)}`, href: hubHref(thinnest) },
      secondary: { label: 'Open the record', href: '/execute/chain-of-trust' },
      earnNote: `I’ll prepare the next ${hubLabel(thinnest).toLowerCase()} move and bring it back for your approval.`
    });
  }

  return moves.slice(0, MAX_MOVES);
}

const MAX_SIGNALS = 4;

/**
 * The "since you last looked" grid — real rows from the desk reframed as the
 * prototype's overnight signals. Empty desk → empty list (the panel renders
 * an honest line instead).
 */
export function deriveSignals(state: DeskState): DeskSignal[] {
  const signals: DeskSignal[] = [];

  for (const deal of state.recentDeals.slice(0, 2)) {
    signals.push({
      id: `deal-${deal.id}`,
      icon: 'radar',
      tone: 'azure',
      label: `${deal.name} is on the desk${deal.amount != null ? ` · ${compactMoney(deal.amount)}` : ''}`,
      cta: 'Open the pipeline',
      href: '/source/pipeline'
    });
  }

  for (const c of state.topWarmConnections.slice(0, 2)) {
    const hot = c.status === 'hot';
    signals.push({
      id: `rel-${c.id}`,
      icon: hot ? 'flame' : 'handshake',
      tone: hot ? 'gold' : 'neutral',
      label: `${c.name}${c.company ? ` · ${c.company}` : ''} is ${c.status}`,
      cta: 'Work the relationship',
      href: '/source/capital-map'
    });
  }

  return signals.slice(0, MAX_SIGNALS);
}
