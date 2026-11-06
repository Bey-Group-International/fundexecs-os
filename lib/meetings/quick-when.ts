// lib/meetings/quick-when.ts
// "tue 3pm 30m", "tomorrow 9:30 for 1h", "nov 12 noon": a when typed the way
// people say it, read into the schedule form's date, start and length.
//
// Deliberately small. It reads a day, a time and a length in any order and
// says nothing about anything else, so a host who types something it does not
// understand gets "Couldn't read that", not a meeting quietly put on the wrong
// day. Dates are calendar dates in the meeting's own zone, the same wall clock
// the form's inputs hold.
//
// Pure: no React, no DOM.

import { zonedDateTime } from "@/lib/meetings/schedule";

export interface QuickWhen {
  /** "YYYY-MM-DD", or null when only a time or length was given. */
  date: string | null;
  /** "HH:mm", or null when only a day or length was given. */
  time: string | null;
  /** Length in minutes, or null when none was given. */
  minutes: number | null;
}

const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function addDays(date: string, days: number): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function weekdayOf(date: string): number {
  return new Date(`${date}T12:00:00Z`).getUTCDay();
}

/** "mon", "tues", "thurs", "wednesday" — any prefix of three letters or more. */
function weekdayIndex(word: string): number {
  if (word.length < 3) return -1;
  return WEEKDAYS.findIndex((d) => d.startsWith(word));
}

function monthIndex(word: string): number {
  if (word.length < 3) return -1;
  return MONTHS.findIndex((m) => word.startsWith(m));
}

/**
 * Read a typed when. Null when nothing in it could be read, or when part of it
 * could not: half-understood is worse than not understood.
 */
export function parseQuickWhen(text: string, now: Date, timezone: string): QuickWhen | null {
  const today = zonedDateTime(now, timezone);
  let s = ` ${text.toLowerCase().replace(/[,]/g, " ").replace(/\s+/g, " ").trim()} `;
  if (!s.trim()) return null;

  let date: string | null = null;
  let time: string | null = null;
  let minutes: number | null = null;

  const take = (re: RegExp, fn: (m: RegExpExecArray) => boolean): void => {
    const m = re.exec(s);
    if (m && fn(m)) s = s.slice(0, m.index) + " " + s.slice(m.index + m[0].length);
  };

  // Length first, so "1h" is never read as a time and "30" in "30m" never as a day.
  take(/\s(?:for\s)?(\d+(?:\.\d+)?)\s?h(?:rs?|ours?)?(?:\s?(\d{1,2})(?:\s?m(?:in(?:ute)?s?)?)?)?(?=\s)/, (m) => {
    minutes = Math.round(Number(m[1]) * 60 + Number(m[2] ?? 0));
    return true;
  });
  if (minutes === null) {
    take(/\s(?:for\s)?(\d{1,3})\s?m(?:in(?:ute)?s?)?(?=\s)/, (m) => {
      minutes = Number(m[1]);
      return true;
    });
  }

  // A day.
  take(/\s(today|tonight|tod)(?=\s)/, () => ((date = today.date), true));
  if (!date) take(/\s(tomorrow|tmrw?|tmw)(?=\s)/, () => ((date = addDays(today.date, 1)), true));
  if (!date) {
    take(/\sin\s(\d{1,3})\sdays?(?=\s)/, (m) => ((date = addDays(today.date, Number(m[1]))), true));
  }
  if (!date) {
    // "nov 12", "12 nov", "november 12th"
    take(/\s([a-z]{3,9})\s(\d{1,2})(?:st|nd|rd|th)?(?=\s)|\s(\d{1,2})(?:st|nd|rd|th)?\s([a-z]{3,9})(?=\s)/, (m) => {
      const month = monthIndex(m[1] ?? m[4]);
      const day = Number(m[2] ?? m[3]);
      if (month < 0 || day < 1 || day > 31) return false;
      const year = Number(today.date.slice(0, 4));
      let candidate = `${year}-${pad(month + 1)}-${pad(day)}`;
      // A date already gone this year means next year's.
      if (candidate < today.date) candidate = `${year + 1}-${pad(month + 1)}-${pad(day)}`;
      // Reject "feb 31": the round trip through Date must land on the same day.
      if (new Date(`${candidate}T12:00:00Z`).toISOString().slice(0, 10) !== candidate) return false;
      date = candidate;
      return true;
    });
  }
  if (!date) {
    take(/\s(next\s)?([a-z]{3,9})(?=\s)/, (m) => {
      const wd = weekdayIndex(m[2]);
      if (wd < 0) return false;
      let ahead = (wd - weekdayOf(today.date) + 7) % 7;
      // "tue" said on a Tuesday is next week's.
      if (ahead === 0) ahead = 7;
      // "next tue" skips a Tuesday still to come this week (weeks run Monday to
      // Sunday), and otherwise means the coming one.
      const toSunday = (7 - weekdayOf(today.date)) % 7;
      if (m[1] && ahead <= toSunday) ahead += 7;
      date = addDays(today.date, ahead);
      return true;
    });
  }

  // A time.
  take(/\s(noon|midday)(?=\s)/, () => ((time = "12:00"), true));
  if (!time) take(/\s(midnight)(?=\s)/, () => ((time = "00:00"), true));
  if (!time) {
    take(/\s(?:at\s)?(\d{1,2})(?::(\d{2}))?\s?(am|pm|a|p)(?=\s)/, (m) => {
      let h = Number(m[1]);
      const mi = Number(m[2] ?? 0);
      if (h < 1 || h > 12 || mi > 59) return false;
      if (m[3].startsWith("p") && h !== 12) h += 12;
      if (m[3].startsWith("a") && h === 12) h = 0;
      time = `${pad(h)}:${pad(mi)}`;
      return true;
    });
  }
  if (!time) {
    take(/\s(?:at\s)?(\d{1,2}):(\d{2})(?=\s)/, (m) => {
      const h = Number(m[1]);
      const mi = Number(m[2]);
      if (h > 23 || mi > 59) return false;
      time = `${pad(h)}:${pad(mi)}`;
      return true;
    });
  }
  if (!time) {
    // A bare "at 3" reads as the working-day hour it almost always means.
    take(/\sat\s(\d{1,2})(?=\s)/, (m) => {
      let h = Number(m[1]);
      if (h < 1 || h > 23) return false;
      if (h >= 1 && h <= 7) h += 12;
      time = `${pad(h)}:00`;
      return true;
    });
  }

  // Filler words are fine; anything else left over is something not understood.
  const rest = s.replace(/\b(at|on|for|from|the|this|a|an)\b/g, " ").trim();
  if (rest) return null;
  // Set inside the closures above, which narrowing cannot see.
  const out = { date, time, minutes } as QuickWhen;
  if (out.date === null && out.time === null && out.minutes === null) return null;
  if (out.minutes !== null && (out.minutes < 5 || out.minutes > 24 * 60)) return null;

  // A time with no day: today if it is still to come, otherwise tomorrow.
  if (out.time && !out.date) out.date = out.time > today.time ? today.date : addDays(today.date, 1);

  return out;
}

/** "Tue, Nov 10 · 3:00 PM · 30 min" — what the parse understood, to show before it is applied. */
export function describeQuickWhen(when: QuickWhen): string {
  const parts: string[] = [];
  if (when.date) {
    const d = new Date(`${when.date}T12:00:00Z`);
    parts.push(d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" }));
  }
  if (when.time) {
    const [h, m] = when.time.split(":").map(Number);
    parts.push(`${h % 12 || 12}:${pad(m)} ${h < 12 ? "AM" : "PM"}`);
  }
  if (when.minutes) {
    const h = Math.floor(when.minutes / 60);
    const m = when.minutes % 60;
    parts.push(h && m ? `${h}h ${m}m` : h ? `${h}h` : `${m} min`);
  }
  return parts.join(" · ");
}
