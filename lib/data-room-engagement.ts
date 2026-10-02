// lib/data-room-engagement.ts
//
// What each investor did in a data room, built from data_room_views rows, and
// the clock the viewer uses to measure reading time per document. Pure: the
// page, Earn's read and the tests all build from the same functions.

// ---------------------------------------------------------------------------
// The viewer's reading clock
// ---------------------------------------------------------------------------

/** No input for this long and the reader has walked away: stop counting. */
export const IDLE_MS = 120_000;
/** Longer gaps between ticks (a sleeping laptop) are never counted. */
const MAX_TICK_MS = 15_000;

/**
 * Accumulates seconds per document while the reader is actually reading:
 * the tab is visible, they have touched the page recently, and a document
 * (or, with `null`, a non-document section) is in view. The viewer ticks it
 * every few seconds and drains it on a timer, on section change and on exit.
 */
export class ReadingClock {
  private last: number | null = null;
  private lastInput: number;
  private ms = new Map<string | null, number>();

  constructor(now: number) {
    this.lastInput = now;
  }

  /** Any scroll, key, pointer or wheel. */
  input(now: number): void {
    this.lastInput = now;
  }

  /**
   * Credit the time since the last tick to what is in view now, then note
   * whether the tab is visible. Tick when the tab hides too: the stretch up to
   * hiding was read; nothing after it is, until a tick sees the tab again.
   */
  tick(now: number, inView: string | null, visible: boolean): void {
    if (this.last !== null && now - this.lastInput <= IDLE_MS) {
      const dt = now - this.last;
      if (dt > 0 && dt <= MAX_TICK_MS) this.ms.set(inView, (this.ms.get(inView) ?? 0) + dt);
    }
    this.last = visible ? now : null;
  }

  /** Whole seconds per document since the last drain; sub-second remainders carry over. */
  drain(): { documentId: string | null; seconds: number }[] {
    const out: { documentId: string | null; seconds: number }[] = [];
    for (const [documentId, ms] of this.ms) {
      const seconds = Math.floor(ms / 1000);
      if (seconds <= 0) continue;
      out.push({ documentId, seconds });
      this.ms.set(documentId, ms - seconds * 1000);
    }
    return out;
  }
}

// ---------------------------------------------------------------------------
// Investor activity
// ---------------------------------------------------------------------------

export interface EngagementView {
  share_id: string | null;
  document_id: string | null;
  kind: string;
  action: string | null;
  viewer_email: string | null;
  session_id: string | null;
  duration_seconds: number | null;
  created_at: string;
}

export type Action = "open" | "download" | "read";

/** Rows written before `action` existed: a duration means reading, none an open. */
export function actionOf(v: Pick<EngagementView, "action" | "duration_seconds">): Action {
  if (v.action === "open" || v.action === "download" || v.action === "read") return v.action;
  return v.duration_seconds && v.duration_seconds > 0 ? "read" : "open";
}

export interface DocActivity {
  documentId: string;
  name: string;
  seconds: number;
  opens: number;
  downloads: number;
}

/** One line of an investor's timeline: what they did with one document on one day. */
export interface TimelineEntry {
  day: string; // YYYY-MM-DD (UTC)
  documentId: string | null;
  name: string;
  seconds: number;
  opens: number;
  downloads: number;
  lastAt: string;
}

export type Signal = "hot" | "warm" | "cold";

export interface InvestorActivity {
  key: string; // email:… or visitor:…
  email: string | null;
  label: string;
  firstSeen: string;
  lastSeen: string;
  /** Distinct days with any activity. */
  visitDays: number;
  seconds: number;
  downloads: number;
  documents: DocActivity[];
  timeline: TimelineEntry[];
  links: string[];
  signal: Signal;
}

export interface RoomEngagement {
  investors: InvestorActivity[];
  /** Every document anyone touched, most-read first. */
  topDocuments: (DocActivity & { readers: number })[];
  totals: { readers: number; seconds: number; opens: number; downloads: number };
  /** Newest activity in the room. */
  latestAt: string | null;
}

const DAY_MS = 86_400_000;

export function signalFor(
  a: Pick<InvestorActivity, "seconds" | "downloads" | "visitDays" | "lastSeen">,
  now: number,
): Signal {
  const ageDays = (now - new Date(a.lastSeen).getTime()) / DAY_MS;
  if (ageDays > 21) return "cold";
  if (a.seconds >= 900 || (a.downloads > 0 && a.seconds >= 300) || (a.visitDays >= 3 && ageDays <= 7)) return "hot";
  if (a.seconds < 60 && a.downloads === 0) return "cold";
  return "warm";
}

export function buildEngagement(
  views: EngagementView[],
  docNames: Map<string, string>,
  linkLabels: Map<string, string> = new Map(),
  now = Date.now(),
): RoomEngagement {
  // A reader's rows carry their email once they passed an email gate, and a
  // browser id on the rows the viewer writes. Join the two so a reader who
  // gave an email is one investor across both kinds of row.
  const emailBySession = new Map<string, string>();
  for (const v of views) {
    if (v.session_id && v.viewer_email) emailBySession.set(v.session_id, v.viewer_email.toLowerCase());
  }
  const keyOf = (v: EngagementView): { key: string; email: string | null } | null => {
    const email = v.viewer_email?.toLowerCase() || (v.session_id ? emailBySession.get(v.session_id) : undefined);
    if (email) return { key: `email:${email}`, email };
    if (v.session_id) return { key: `visitor:${v.session_id}`, email: null };
    return null;
  };
  const nameOf = (id: string | null) => (id ? (docNames.get(id) ?? "A removed document") : "Room overview");

  type Acc = {
    email: string | null;
    first: string;
    last: string;
    days: Set<string>;
    links: Set<string>;
    docs: Map<string, DocActivity>;
    timeline: Map<string, TimelineEntry>;
  };
  const people = new Map<string, Acc>();
  const roomDocs = new Map<string, DocActivity & { readerSet: Set<string> }>();
  const totals = { readers: 0, seconds: 0, opens: 0, downloads: 0 };
  let latestAt: string | null = null;

  for (const v of views) {
    const act = actionOf(v);
    const secs = act === "read" ? Math.max(0, v.duration_seconds ?? 0) : 0;
    if (!latestAt || v.created_at > latestAt) latestAt = v.created_at;
    totals.seconds += secs;
    if (act === "open" && v.kind === "room") totals.opens += 1;
    if (act === "download") totals.downloads += 1;

    const who = keyOf(v);
    if (v.document_id) {
      const d =
        roomDocs.get(v.document_id) ??
        { documentId: v.document_id, name: nameOf(v.document_id), seconds: 0, opens: 0, downloads: 0, readerSet: new Set<string>() };
      d.seconds += secs;
      if (act === "open") d.opens += 1;
      if (act === "download") d.downloads += 1;
      if (who && (secs > 0 || act !== "read")) d.readerSet.add(who.key);
      roomDocs.set(v.document_id, d);
    }
    if (!who) continue;

    const p =
      people.get(who.key) ??
      { email: who.email, first: v.created_at, last: v.created_at, days: new Set<string>(), links: new Set<string>(), docs: new Map(), timeline: new Map() };
    if (who.email) p.email = who.email;
    if (v.created_at < p.first) p.first = v.created_at;
    if (v.created_at > p.last) p.last = v.created_at;
    const day = v.created_at.slice(0, 10);
    p.days.add(day);
    if (v.share_id) p.links.add(linkLabels.get(v.share_id) ?? "Untitled link");

    if (v.document_id) {
      const d = p.docs.get(v.document_id) ?? { documentId: v.document_id, name: nameOf(v.document_id), seconds: 0, opens: 0, downloads: 0 };
      d.seconds += secs;
      if (act === "open") d.opens += 1;
      if (act === "download") d.downloads += 1;
      p.docs.set(v.document_id, d);
    }
    const tKey = `${day}|${v.document_id ?? ""}`;
    const t =
      p.timeline.get(tKey) ??
      { day, documentId: v.document_id, name: nameOf(v.document_id), seconds: 0, opens: 0, downloads: 0, lastAt: v.created_at };
    t.seconds += secs;
    if (act === "open") t.opens += 1;
    if (act === "download") t.downloads += 1;
    if (v.created_at > t.lastAt) t.lastAt = v.created_at;
    p.timeline.set(tKey, t);
    people.set(who.key, p);
  }

  const investors: InvestorActivity[] = [...people.entries()].map(([key, p]) => {
    const documents = [...p.docs.values()].sort((a, b) => b.seconds - a.seconds || b.opens - a.opens);
    const seconds = [...p.timeline.values()].reduce((n, t) => n + t.seconds, 0);
    const downloads = documents.reduce((n, d) => n + d.downloads, 0);
    const base = { seconds, downloads, visitDays: p.days.size, lastSeen: p.last };
    return {
      key,
      email: p.email,
      label: p.email ?? `Visitor ${key.slice("visitor:".length, "visitor:".length + 6)}`,
      firstSeen: p.first,
      lastSeen: p.last,
      visitDays: p.days.size,
      seconds,
      downloads,
      documents,
      // Room-overview rows with nothing in them (a bare open) add noise.
      timeline: [...p.timeline.values()]
        .filter((t) => t.documentId || t.seconds > 0)
        .sort((a, b) => (a.lastAt > b.lastAt ? -1 : 1)),
      links: [...p.links],
      signal: signalFor(base, now),
    };
  });
  // Named investors first, then by engagement.
  investors.sort((a, b) => Number(Boolean(b.email)) - Number(Boolean(a.email)) || b.seconds - a.seconds || (a.lastSeen > b.lastSeen ? -1 : 1));
  totals.readers = investors.length;

  return {
    investors,
    topDocuments: [...roomDocs.values()]
      .map(({ readerSet, ...d }) => ({ ...d, readers: readerSet.size }))
      .sort((a, b) => b.seconds - a.seconds || b.readers - a.readers || b.opens - a.opens),
    totals,
    latestAt,
  };
}

// ---------------------------------------------------------------------------
// The offline read (used when Earn's model is not configured or fails)
// ---------------------------------------------------------------------------

export function formatSeconds(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const m = Math.round(seconds / 60);
  if (m < 60) return `${m} min`;
  return `${Math.floor(m / 60)} h ${m % 60} min`;
}

export function ruleRead(a: InvestorActivity): { summary: string; follow_up: string; signal: Signal } {
  const top = a.documents[0];
  const read = a.documents.filter((d) => d.seconds > 0);
  const parts = [
    `${formatSeconds(a.seconds)} reading across ${a.visitDays} day${a.visitDays === 1 ? "" : "s"}`,
    read.length ? `${read.length} document${read.length === 1 ? "" : "s"} read` : "no document read yet",
  ];
  if (top && top.seconds > 0) parts.push(`most time on ${top.name}`);
  if (a.downloads) parts.push(`${a.downloads} download${a.downloads === 1 ? "" : "s"}`);
  const summary = `${parts.join("; ")}.`;
  const who = a.email ?? "this reader";
  const follow_up =
    a.signal === "hot"
      ? `Reach out to ${who} now${top ? ` and offer to walk through ${top.name}` : ""}.`
      : a.signal === "warm"
        ? `Send ${who} a short note pointing to what matters most${top ? ` beyond ${top.name}` : ""}.`
        : `Low engagement. A light check-in to ${who} in a week, or leave it.`;
  return { summary, follow_up, signal: a.signal };
}
