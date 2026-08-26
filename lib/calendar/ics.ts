// lib/calendar/ics.ts
// iCalendar (RFC 5545) reading and writing — the interchange format every
// calendar speaks. One implementation serves both directions: publishing a feed
// other calendars subscribe to, and importing a feed so externally-booked time
// stops this app offering the slot.
//
// Hand-rolled deliberately. The repo carries no calendar dependency and the
// subset that matters here is small and testable; a general RFC 5545 library
// would be far more surface than the feature needs.
//
// WHAT IS SUPPORTED, and what is not, because a silent gap in a busy-time
// importer means double-bookings:
//
//   ✓ VEVENT with DTSTART/DTEND, or DTSTART + DURATION
//   ✓ UTC (Z), floating, and TZID datetimes for IANA zone names
//   ✓ All-day events (VALUE=DATE), treated as busy for the whole local day
//   ✓ RRULE FREQ=DAILY|WEEKLY|MONTHLY|YEARLY with INTERVAL, COUNT, UNTIL, BYDAY
//   ✓ EXDATE, and RECURRENCE-ID overrides skipped rather than double-counted
//   ✓ STATUS:CANCELLED and TRANSP:TRANSPARENT excluded from busy time
//   ✓ Line unfolding, parameter parsing, and value unescaping
//
//   ✗ VTIMEZONE definitions with custom offset rules. A TZID that is not a
//     recognizable IANA zone falls back to UTC, which can shift an event.
//   ✗ BYSETPOS, BYMONTHDAY, BYWEEKNO and the rarer RRULE parts. An event using
//     only those recurs on its start day pattern instead — see expandRecurrence.
//   ✗ VTODO, VJOURNAL, VFREEBUSY, attachments, alarms. Ignored, not an error.
//
// Anything unparseable is skipped rather than thrown: one malformed event in a
// third-party feed must not cost a host their whole availability picture.

export interface IcsEvent {
  uid: string;
  summary: string | null;
  /** Start instant, ISO 8601 UTC. */
  startIso: string;
  /** End instant, ISO 8601 UTC. Exclusive, per RFC 5545's half-open ranges. */
  endIso: string;
  allDay: boolean;
  /** True when the event should NOT consume availability (free / cancelled). */
  transparent: boolean;
  status: string | null;
  location: string | null;
  description: string | null;
}

// ── Line handling ───────────────────────────────────────────────────────────

/**
 * Undo RFC 5545 line folding: a CRLF followed by a space or tab continues the
 * previous line. Feeds in the wild use bare LF too, so both are accepted.
 */
export function unfoldLines(text: string): string[] {
  const raw = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  const out: string[] = [];
  for (const line of raw) {
    if ((line.startsWith(" ") || line.startsWith("\t")) && out.length > 0) {
      out[out.length - 1] += line.slice(1);
    } else {
      out.push(line);
    }
  }
  return out.filter((l) => l.length > 0);
}

export interface IcsProperty {
  name: string;
  params: Record<string, string>;
  value: string;
}

/**
 * Split one content line into name, parameters, and value.
 *
 * The colon that ends the name/params section is not simply the first colon:
 * a quoted parameter value may contain one (e.g. `ALTREP="http://x"`), so the
 * scan tracks quoting.
 */
export function parsePropertyLine(line: string): IcsProperty | null {
  let inQuotes = false;
  let colonAt = -1;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') inQuotes = !inQuotes;
    else if (ch === ":" && !inQuotes) {
      colonAt = i;
      break;
    }
  }
  if (colonAt === -1) return null;

  const head = line.slice(0, colonAt);
  const value = line.slice(colonAt + 1);
  const parts = splitUnquoted(head, ";");
  const name = (parts.shift() ?? "").trim().toUpperCase();
  if (!name) return null;

  const params: Record<string, string> = {};
  for (const p of parts) {
    const eq = p.indexOf("=");
    if (eq === -1) continue;
    const key = p.slice(0, eq).trim().toUpperCase();
    let v = p.slice(eq + 1).trim();
    if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1);
    params[key] = v;
  }
  return { name, params, value };
}

function splitUnquoted(text: string, sep: string): string[] {
  const out: string[] = [];
  let current = "";
  let inQuotes = false;
  for (const ch of text) {
    if (ch === '"') inQuotes = !inQuotes;
    if (ch === sep && !inQuotes) {
      out.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  out.push(current);
  return out;
}

/** Reverse RFC 5545 text escaping. */
export function unescapeText(value: string): string {
  return value
    .replace(/\\n/gi, "\n")
    .replace(/\\,/g, ",")
    .replace(/\\;/g, ";")
    .replace(/\\\\/g, "\\");
}

/** Apply RFC 5545 text escaping. Backslash first, or it double-escapes. */
export function escapeText(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/\n/g, "\\n")
    .replace(/,/g, "\\,")
    .replace(/;/g, "\\;");
}

// ── Time ────────────────────────────────────────────────────────────────────

/**
 * The UTC instant for a wall-clock time in an IANA zone.
 *
 * Intl gives the reverse mapping (instant → wall time), so this inverts it:
 * guess that the wall time is UTC, measure how far that guess lands from the
 * target in the zone, and correct. The second pass matters around DST
 * transitions, where the first correction can overshoot into a different offset.
 * Returns null for a zone Intl does not recognize, so callers can decide rather
 * than silently getting a wrong instant.
 */
export function zonedWallTimeToUtc(
  parts: { year: number; month: number; day: number; hour: number; minute: number; second: number },
  timeZone: string,
): Date | null {
  const asUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
  let guess = asUtc;
  for (let i = 0; i < 2; i++) {
    const offset = zoneOffsetMs(new Date(guess), timeZone);
    if (offset === null) return null;
    const corrected = asUtc - offset;
    if (corrected === guess) break;
    guess = corrected;
  }
  return new Date(guess);
}

/** How far ahead of UTC `timeZone` is at `instant`, in ms. Null if unknown. */
function zoneOffsetMs(instant: Date, timeZone: string): number | null {
  try {
    const fmt = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hour12: false,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    const map: Record<string, number> = {};
    for (const part of fmt.formatToParts(instant)) {
      if (part.type !== "literal") map[part.type] = Number(part.value);
    }
    // Intl renders midnight as hour 24 in some engines; normalize it.
    const hour = map.hour === 24 ? 0 : map.hour;
    const asIfUtc = Date.UTC(map.year, map.month - 1, map.day, hour, map.minute, map.second);
    return asIfUtc - instant.getTime();
  } catch {
    return null;
  }
}

export interface ParsedDate {
  date: Date;
  /** VALUE=DATE — a whole day, with no time component. */
  dateOnly: boolean;
}

/**
 * Parse an iCalendar date or date-time. Handles the three forms RFC 5545
 * allows: UTC (trailing Z), a TZID parameter, and floating local time.
 *
 * A floating time has no zone by definition. It is read as UTC, which is the
 * only stable choice on a server — and is why an imported floating event can
 * sit up to a day off. Feeds from real calendar products virtually always carry
 * Z or TZID.
 */
export function parseIcsDate(value: string, params: Record<string, string> = {}): ParsedDate | null {
  const raw = value.trim();
  const dateOnly = params.VALUE === "DATE" || /^\d{8}$/.test(raw);

  const m = raw.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?$/);
  if (!m) return null;
  const [, y, mo, d, h, mi, s, z] = m;
  const parts = {
    year: Number(y),
    month: Number(mo),
    day: Number(d),
    hour: Number(h ?? 0),
    minute: Number(mi ?? 0),
    second: Number(s ?? 0),
  };

  if (dateOnly) {
    // A date-only value is midnight in the *local* zone of whoever reads it.
    // Treating it as UTC midnight keeps whole-day events whole.
    return { date: new Date(Date.UTC(parts.year, parts.month - 1, parts.day)), dateOnly: true };
  }

  if (z === "Z") {
    return {
      date: new Date(Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second)),
      dateOnly: false,
    };
  }

  if (params.TZID) {
    const resolved = zonedWallTimeToUtc(parts, params.TZID);
    if (resolved) return { date: resolved, dateOnly: false };
    // Unknown TZID: fall through to the floating reading rather than dropping
    // the event, so the time still blocks roughly the right part of the day.
  }

  return {
    date: new Date(Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second)),
    dateOnly: false,
  };
}

/** Parse an RFC 5545 DURATION (e.g. `PT1H30M`, `P2D`) to milliseconds. */
export function parseIcsDuration(value: string): number | null {
  const m = value.trim().match(/^([+-])?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/);
  if (!m) return null;
  const [, sign, w, d, h, mi, s] = m;
  const ms =
    Number(w ?? 0) * 604_800_000 +
    Number(d ?? 0) * 86_400_000 +
    Number(h ?? 0) * 3_600_000 +
    Number(mi ?? 0) * 60_000 +
    Number(s ?? 0) * 1000;
  if (ms === 0 && !w && !d && !h && !mi && !s) return null;
  return sign === "-" ? -ms : ms;
}

// ── Recurrence ──────────────────────────────────────────────────────────────

const WEEKDAY_INDEX: Record<string, number> = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 };

export interface RRule {
  freq: "DAILY" | "WEEKLY" | "MONTHLY" | "YEARLY";
  interval: number;
  count: number | null;
  until: Date | null;
  /** BYDAY weekday names (SU..SA). Positional prefixes like 2MO are ignored. */
  byDay: string[];
}

export function parseRRule(value: string): RRule | null {
  const parts: Record<string, string> = {};
  for (const chunk of value.split(";")) {
    const eq = chunk.indexOf("=");
    if (eq === -1) continue;
    parts[chunk.slice(0, eq).trim().toUpperCase()] = chunk.slice(eq + 1).trim();
  }
  const freq = (parts.FREQ ?? "").toUpperCase();
  if (freq !== "DAILY" && freq !== "WEEKLY" && freq !== "MONTHLY" && freq !== "YEARLY") return null;

  const interval = Math.max(1, Number(parts.INTERVAL ?? 1) || 1);
  const count = parts.COUNT ? Math.max(0, Number(parts.COUNT) || 0) : null;
  const until = parts.UNTIL ? parseIcsDate(parts.UNTIL)?.date ?? null : null;
  const byDay = (parts.BYDAY ?? "")
    .split(",")
    .map((d) => d.trim().toUpperCase().replace(/^[+-]?\d+/, ""))
    .filter((d) => d in WEEKDAY_INDEX);

  return { freq, interval, count, until, byDay };
}

/**
 * The start instants a recurring event produces inside a window.
 *
 * Bounded three ways — the window, the rule's own COUNT/UNTIL, and a hard
 * iteration cap — because a feed can legitimately contain an unbounded daily
 * rule, and an availability lookup must not become an unbounded loop.
 *
 * Unsupported BYxxx parts (BYSETPOS, BYMONTHDAY…) are ignored rather than
 * refused: the event then recurs on its DTSTART pattern, which over-reports
 * busy time slightly. For a double-booking guard, over-reporting is the safe
 * direction to be wrong in.
 */
export function expandRecurrence(
  start: Date,
  rule: RRule,
  windowStart: Date,
  windowEnd: Date,
  opts: { maxOccurrences?: number } = {},
): Date[] {
  const max = opts.maxOccurrences ?? 1000;
  const out: Date[] = [];
  const hardEnd = rule.until && rule.until < windowEnd ? rule.until : windowEnd;

  // Every occurrence is computed from DTSTART rather than from the previous
  // one. Stepping cumulatively drifts: a monthly series starting Jan 31 clamps
  // to Feb 28, and stepping from there lands on Mar 28 instead of Mar 31.
  const nth = (n: number): Date => {
    switch (rule.freq) {
      case "DAILY":
        return new Date(start.getTime() + n * rule.interval * 86_400_000);
      case "WEEKLY":
        return new Date(start.getTime() + n * rule.interval * 7 * 86_400_000);
      case "MONTHLY":
        return addMonthsUtc(start, n * rule.interval);
      case "YEARLY":
        return addMonthsUtc(start, n * rule.interval * 12);
    }
  };

  // WEEKLY with BYDAY repeats on several weekdays per interval, so each step
  // covers a week and emits the named days within it.
  const weeklyDays =
    rule.freq === "WEEKLY" && rule.byDay.length > 0
      ? [...rule.byDay.map((d) => WEEKDAY_INDEX[d])].sort((a, b) => a - b)
      : null;

  let emitted = 0;

  if (weeklyDays) {
    // Sunday of the week DTSTART falls in — the anchor every interval steps from.
    const anchor = new Date(start.getTime());
    anchor.setUTCDate(anchor.getUTCDate() - anchor.getUTCDay());

    for (let week = 0; week < max; week++) {
      const weekStart = new Date(anchor.getTime() + week * rule.interval * 7 * 86_400_000);
      if (weekStart > hardEnd) break;

      for (const dow of weeklyDays) {
        const occ = new Date(weekStart.getTime());
        occ.setUTCDate(occ.getUTCDate() + dow);
        occ.setUTCHours(start.getUTCHours(), start.getUTCMinutes(), start.getUTCSeconds(), 0);
        // A series never starts before DTSTART, even if BYDAY names an earlier
        // weekday in that first week.
        if (occ < start) continue;
        if (occ > hardEnd) break;
        if (rule.count !== null && emitted >= rule.count) break;
        emitted++;
        if (occ >= windowStart) out.push(new Date(occ.getTime()));
      }
      if (rule.count !== null && emitted >= rule.count) break;
      if (out.length >= max) break;
    }
    return out;
  }

  for (let n = 0; n < max; n++) {
    if (rule.count !== null && emitted >= rule.count) break;
    const occ = nth(n);
    if (occ > hardEnd) break;
    emitted++;
    if (occ >= windowStart) out.push(occ);
    if (out.length >= max) break;
  }

  return out;
}

/**
 * Add months, clamping to the last valid day. Without the clamp, a 31st
 * recurrence rolls into the following month and drifts from then on.
 */
function addMonthsUtc(date: Date, months: number): Date {
  const day = date.getUTCDate();
  const shifted = new Date(date.getTime());
  shifted.setUTCDate(1);
  shifted.setUTCMonth(shifted.getUTCMonth() + months);
  const lastDay = new Date(Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth() + 1, 0)).getUTCDate();
  shifted.setUTCDate(Math.min(day, lastDay));
  return shifted;
}

// ── Parsing a calendar ──────────────────────────────────────────────────────

/** How long an all-day event occupies. */
const DAY_MS = 86_400_000;

interface RawEvent {
  props: IcsProperty[];
}

function splitEvents(lines: string[]): RawEvent[] {
  const events: RawEvent[] = [];
  let current: IcsProperty[] | null = null;
  // VEVENTs can contain nested VALARM blocks; ignore everything inside one so
  // an alarm's TRIGGER or DESCRIPTION is not mistaken for the event's own.
  let alarmDepth = 0;

  for (const line of lines) {
    const prop = parsePropertyLine(line);
    if (!prop) continue;

    if (prop.name === "BEGIN") {
      const kind = prop.value.trim().toUpperCase();
      if (kind === "VEVENT") current = [];
      else if (current && kind === "VALARM") alarmDepth++;
      continue;
    }
    if (prop.name === "END") {
      const kind = prop.value.trim().toUpperCase();
      if (kind === "VALARM" && alarmDepth > 0) alarmDepth--;
      else if (kind === "VEVENT" && current) {
        events.push({ props: current });
        current = null;
      }
      continue;
    }
    if (current && alarmDepth === 0) current.push(prop);
  }
  return events;
}

function firstProp(props: IcsProperty[], name: string): IcsProperty | undefined {
  return props.find((p) => p.name === name);
}

export interface ParseIcsOptions {
  /** Only events overlapping this window are returned. */
  windowStart: Date;
  windowEnd: Date;
  /** Cap on events returned, so a hostile or huge feed stays bounded. */
  maxEvents?: number;
}

/**
 * Read a calendar into concrete, expanded events inside a window.
 *
 * Recurring events are expanded here rather than left as rules, so every
 * consumer sees the same flat list of instants and nothing downstream has to
 * understand RRULE.
 */
export function parseIcs(text: string, opts: ParseIcsOptions): IcsEvent[] {
  const maxEvents = opts.maxEvents ?? 2000;
  const out: IcsEvent[] = [];

  let raws: RawEvent[];
  try {
    raws = splitEvents(unfoldLines(text));
  } catch {
    return [];
  }

  for (const raw of raws) {
    if (out.length >= maxEvents) break;
    try {
      // A RECURRENCE-ID event is a modified single instance of a series. The
      // series expansion already covers that slot, so counting this too would
      // double-book the same time.
      if (firstProp(raw.props, "RECURRENCE-ID")) continue;

      const dtStart = firstProp(raw.props, "DTSTART");
      if (!dtStart) continue;
      const start = parseIcsDate(dtStart.value, dtStart.params);
      if (!start) continue;

      const dtEnd = firstProp(raw.props, "DTEND");
      const duration = firstProp(raw.props, "DURATION");
      let durationMs: number;
      if (dtEnd) {
        const end = parseIcsDate(dtEnd.value, dtEnd.params);
        if (!end) continue;
        durationMs = end.date.getTime() - start.date.getTime();
      } else if (duration) {
        durationMs = parseIcsDuration(duration.value) ?? 0;
      } else {
        // RFC 5545: a date-only DTSTART with no end lasts one day; a
        // date-time with no end is instantaneous.
        durationMs = start.dateOnly ? DAY_MS : 0;
      }
      if (durationMs <= 0) durationMs = start.dateOnly ? DAY_MS : 0;

      const status = firstProp(raw.props, "STATUS")?.value.trim().toUpperCase() ?? null;
      const transp = firstProp(raw.props, "TRANSP")?.value.trim().toUpperCase() ?? null;
      const transparent = transp === "TRANSPARENT" || status === "CANCELLED";

      const uid = firstProp(raw.props, "UID")?.value.trim() || `no-uid-${out.length}`;
      const summary = firstProp(raw.props, "SUMMARY");
      const location = firstProp(raw.props, "LOCATION");
      const description = firstProp(raw.props, "DESCRIPTION");

      const base = {
        uid,
        summary: summary ? unescapeText(summary.value) : null,
        allDay: start.dateOnly,
        transparent,
        status,
        location: location ? unescapeText(location.value) : null,
        description: description ? unescapeText(description.value) : null,
      };

      // Instants this event occupies: one, or many if it recurs.
      const rruleProp = firstProp(raw.props, "RRULE");
      const rule = rruleProp ? parseRRule(rruleProp.value) : null;

      const excluded = new Set<number>();
      for (const p of raw.props) {
        if (p.name !== "EXDATE") continue;
        for (const piece of p.value.split(",")) {
          const ex = parseIcsDate(piece, p.params);
          if (ex) excluded.add(ex.date.getTime());
        }
      }

      const starts = rule
        ? expandRecurrence(start.date, rule, opts.windowStart, opts.windowEnd)
        : [start.date];

      for (const s of starts) {
        if (out.length >= maxEvents) break;
        if (excluded.has(s.getTime())) continue;
        const e = new Date(s.getTime() + durationMs);
        // Overlap, not containment: an event starting before the window and
        // running into it still occupies time inside it.
        if (e <= opts.windowStart || s >= opts.windowEnd) continue;
        out.push({ ...base, startIso: s.toISOString(), endIso: e.toISOString() });
      }
    } catch {
      // Skip this event; a single bad entry must not lose the rest of the feed.
      continue;
    }
  }

  return out;
}

/** Events that actually consume availability. */
export function busyEventsOnly(events: IcsEvent[]): IcsEvent[] {
  return events.filter((e) => !e.transparent);
}

// ── Writing a calendar ──────────────────────────────────────────────────────

/** Format an instant as an iCalendar UTC date-time. */
export function toIcsUtc(date: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return (
    `${date.getUTCFullYear()}${p(date.getUTCMonth() + 1)}${p(date.getUTCDate())}` +
    `T${p(date.getUTCHours())}${p(date.getUTCMinutes())}${p(date.getUTCSeconds())}Z`
  );
}

/**
 * Fold a content line to 75 octets, per RFC 5545.
 *
 * The limit is octets, not characters, so folding counts UTF-8 byte length —
 * splitting mid-character would corrupt the value. Continuation lines begin
 * with a single space.
 */
export function foldLine(line: string): string {
  const encoder = new TextEncoder();
  if (encoder.encode(line).length <= 75) return line;

  const out: string[] = [];
  let current = "";
  let currentBytes = 0;
  let limit = 75;

  for (const ch of line) {
    const chBytes = encoder.encode(ch).length;
    if (currentBytes + chBytes > limit) {
      out.push(current);
      current = ch;
      currentBytes = chBytes;
      limit = 74; // continuation lines lose one octet to the leading space
    } else {
      current += ch;
      currentBytes += chBytes;
    }
  }
  if (current) out.push(current);
  return out.join("\r\n ");
}

export interface IcsFeedEvent {
  uid: string;
  startIso: string;
  endIso: string;
  summary: string;
  description?: string | null;
  location?: string | null;
  url?: string | null;
  /** Cancelled events stay in the feed so subscribers remove them. */
  cancelled?: boolean;
  /** Bumped when an event changes, so clients accept the update. */
  sequence?: number;
}

export interface BuildIcsOptions {
  /** Shown as the calendar's name in subscribing clients. */
  calendarName: string;
  /** Product identifier written into PRODID. */
  prodId?: string;
  /** Overrides "now" for DTSTAMP — tests need it stable. */
  now?: Date;
}

/**
 * Build a subscribable calendar.
 *
 * X-WR-CALNAME and X-PUBLISHED-TTL are non-standard but near-universally
 * honoured: without the first, subscribers show a URL instead of a name, and
 * without the second they choose their own refresh interval.
 */
export function buildIcs(events: IcsFeedEvent[], opts: BuildIcsOptions): string {
  const stamp = toIcsUtc(opts.now ?? new Date());
  const lines: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    `PRODID:${opts.prodId ?? "-//FundExecs OS//Calendar//EN"}`,
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${escapeText(opts.calendarName)}`,
    "X-PUBLISHED-TTL:PT30M",
    "REFRESH-INTERVAL;VALUE=DURATION:PT30M",
  ];

  for (const ev of events) {
    const start = new Date(ev.startIso);
    const end = new Date(ev.endIso);
    if (isNaN(start.getTime()) || isNaN(end.getTime()) || end <= start) continue;

    lines.push("BEGIN:VEVENT");
    lines.push(`UID:${ev.uid}`);
    lines.push(`DTSTAMP:${stamp}`);
    lines.push(`DTSTART:${toIcsUtc(start)}`);
    lines.push(`DTEND:${toIcsUtc(end)}`);
    lines.push(`SUMMARY:${escapeText(ev.summary)}`);
    if (ev.description) lines.push(`DESCRIPTION:${escapeText(ev.description)}`);
    if (ev.location) lines.push(`LOCATION:${escapeText(ev.location)}`);
    if (ev.url) lines.push(`URL:${ev.url}`);
    lines.push(`STATUS:${ev.cancelled ? "CANCELLED" : "CONFIRMED"}`);
    lines.push(`SEQUENCE:${ev.sequence ?? 0}`);
    lines.push("END:VEVENT");
  }

  lines.push("END:VCALENDAR");
  // CRLF line endings are required by the spec, and some clients enforce it.
  return lines.map(foldLine).join("\r\n") + "\r\n";
}
