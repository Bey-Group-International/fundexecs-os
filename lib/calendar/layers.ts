// lib/calendar/layers.ts
// Turning a member's calendar sources into the layers a sidebar renders, and
// the events a grid draws. Pure — the fetching lives in the route, the drawing
// in the component, so the rules are testable on their own.

export type LayerSource = "google" | "ics";

export interface CalendarLayer {
  id: string;
  source: LayerSource;
  name: string;
  color: string | null;
  isVisible: boolean;
  blocksAvailability: boolean;
  isPrimary: boolean;
  canWrite: boolean;
  health: { state: string; message: string | null };
}

export interface ExternalEvent {
  id: string;
  calendarId: string;
  title: string;
  location: string | null;
  link: string | null;
  startsAt: string;
  endsAt: string;
  isAllDay: boolean;
  isBusy: boolean;
}

/**
 * Fallback colors for sources that carry none of their own.
 *
 * Google sends each calendar's color, so those are used as-is and a member's
 * own colour-coding survives. ICS has no such field, so a feed is assigned one
 * deterministically — the same feed keeps the same colour across reloads, which
 * is what makes a colour worth learning.
 */
export const LAYER_PALETTE = [
  "#7c6df2",
  "#2f9e6e",
  "#c2683a",
  "#3a7bc2",
  "#a34a7f",
  "#5c8a3a",
  "#b8863a",
  "#4a6fa3",
] as const;

/** A stable colour for a layer that has none. Keyed by id, not by position. */
export function colorForLayer(layer: Pick<CalendarLayer, "id" | "color">): string {
  if (layer.color) return layer.color;
  // A tiny non-cryptographic hash: the same id must land on the same colour on
  // every render and every device, which rules out anything random.
  let hash = 0;
  for (let i = 0; i < layer.id.length; i++) {
    hash = (hash * 31 + layer.id.charCodeAt(i)) >>> 0;
  }
  return LAYER_PALETTE[hash % LAYER_PALETTE.length];
}

export interface LayerGroup {
  title: string;
  layers: CalendarLayer[];
}

/**
 * The sidebar's two groups.
 *
 * Google's split: calendars you own sit under "My calendars", everything
 * subscribed or shared under "Other calendars". Writability is the honest test
 * of which is which — a calendar you cannot write to is not yours, whatever it
 * is called.
 */
export function groupLayers(layers: CalendarLayer[]): LayerGroup[] {
  const mine = layers.filter((l) => l.canWrite || l.isPrimary);
  const others = layers.filter((l) => !(l.canWrite || l.isPrimary));

  const groups: LayerGroup[] = [];
  if (mine.length) groups.push({ title: "My calendars", layers: mine });
  if (others.length) groups.push({ title: "Other calendars", layers: others });
  return groups;
}

/**
 * Whether a layer needs the member's attention.
 *
 * A broken calendar shows nothing, which looks exactly like an empty one. The
 * difference has to be visible or someone will read a sync failure as a free
 * afternoon.
 */
export function layerNeedsAttention(layer: CalendarLayer): boolean {
  return layer.health.state === "failing" || layer.health.state === "reauth_required";
}

/** External events that belong to a layer the member is currently showing. */
export function visibleEvents(events: ExternalEvent[], layers: CalendarLayer[]): ExternalEvent[] {
  const shown = new Set(layers.filter((l) => l.isVisible).map((l) => l.id));
  return events.filter((e) => shown.has(e.calendarId));
}

/** Index layers by id, for a grid that needs a colour per event. */
export function layerIndex(layers: CalendarLayer[]): Map<string, CalendarLayer> {
  return new Map(layers.map((l) => [l.id, l]));
}

export interface EventSpan {
  event: ExternalEvent;
  /** Minutes from midnight, clamped to the day being drawn. */
  startMinute: number;
  endMinute: number;
}

const DAY_MINUTES = 24 * 60;

/**
 * Where an external event sits on one day's time rail.
 *
 * Clamped to the day, so an event running past midnight draws to the bottom
 * edge on the first day and from the top on the next, rather than overflowing
 * the column or being dropped. All-day events are excluded: they belong in the
 * banner above the rail, not on it.
 */
export function eventSpansForDay(events: ExternalEvent[], day: Date): EventSpan[] {
  const dayStart = new Date(day.getFullYear(), day.getMonth(), day.getDate()).getTime();
  const dayEnd = dayStart + DAY_MINUTES * 60_000;

  const out: EventSpan[] = [];
  for (const event of events) {
    if (event.isAllDay) continue;
    const start = new Date(event.startsAt).getTime();
    const end = new Date(event.endsAt).getTime();
    if (!Number.isFinite(start) || !Number.isFinite(end)) continue;
    if (end <= dayStart || start >= dayEnd) continue;

    const startMinute = Math.max(0, Math.round((start - dayStart) / 60_000));
    const endMinute = Math.min(DAY_MINUTES, Math.round((end - dayStart) / 60_000));
    // A sub-minute sliver is unreadable; give it a floor so it stays clickable.
    out.push({ event, startMinute, endMinute: Math.max(endMinute, startMinute + 15) });
  }

  return out.sort((a, b) => a.startMinute - b.startMinute);
}

/** All-day external events touching a day, for the banner row. */
export function allDayEventsForDay(events: ExternalEvent[], day: Date): ExternalEvent[] {
  const dayStart = new Date(day.getFullYear(), day.getMonth(), day.getDate()).getTime();
  const dayEnd = dayStart + DAY_MINUTES * 60_000;

  return events.filter((e) => {
    if (!e.isAllDay) return false;
    const start = new Date(e.startsAt).getTime();
    const end = new Date(e.endsAt).getTime();
    return Number.isFinite(start) && Number.isFinite(end) && end > dayStart && start < dayEnd;
  });
}
