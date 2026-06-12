/**
 * lib/deal-pipeline/timeline.ts — the deal drawer's activity timeline (pure).
 *
 * Merges two real streams into one newest-first record: member-authored
 * `deal_notes` and the deal's `loop_events` heartbeat (created / stage
 * moves). Pure (no IO) so the merge and the relative-time copy are
 * unit-testable.
 */

export interface TimelineNote {
  id: string;
  body: string;
  createdAt: string;
}

export interface TimelineEvent {
  id: string;
  /** loop_events event_type — 'deal_created' | 'deal_stage' (others ignored). */
  type: string;
  /** The stage recorded on the event's metadata, when present. */
  stage: string | null;
  createdAt: string;
}

export interface TimelineItem {
  id: string;
  kind: 'note' | 'created' | 'stage';
  /** The note body for 'note' items; null for events. */
  body: string | null;
  /** The stage key for 'stage' items; null otherwise. */
  stage: string | null;
  at: string;
}

const EVENT_KIND: Record<string, TimelineItem['kind']> = {
  deal_created: 'created',
  deal_stage: 'stage'
};

/**
 * Interleave notes and recognized events into one newest-first timeline.
 * Unknown event types are dropped rather than rendered as blank rows.
 */
export function mergeTimeline(notes: TimelineNote[], events: TimelineEvent[]): TimelineItem[] {
  const items: TimelineItem[] = [
    ...notes.map<TimelineItem>((n) => ({
      id: n.id,
      kind: 'note',
      body: n.body,
      stage: null,
      at: n.createdAt
    })),
    ...events
      .filter((e) => EVENT_KIND[e.type])
      .map<TimelineItem>((e) => ({
        id: e.id,
        kind: EVENT_KIND[e.type],
        body: null,
        stage: e.stage,
        at: e.createdAt
      }))
  ];
  return items.sort(
    (a, b) => new Date(b.at).getTime() - new Date(a.at).getTime() || a.id.localeCompare(b.id)
  );
}

/** Compact relative time for timeline rows: 'just now' → '3h ago' → '2w ago'. */
export function timeAgo(iso: string, now: Date = new Date()): string {
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return '';
  const mins = Math.max(0, Math.floor((now.getTime() - then) / 60_000));
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 2) return 'yesterday';
  if (days < 14) return `${days}d ago`;
  if (days < 60) return `${Math.floor(days / 7)}w ago`;
  return `${Math.floor(days / 30)}mo ago`;
}
