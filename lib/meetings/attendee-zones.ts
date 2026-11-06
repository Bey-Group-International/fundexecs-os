// lib/meetings/attendee-zones.ts
// What the time being scheduled is for each guest: "3:00 PM in London", and
// whether that is early or late for them — so a host booking 8am New York sees
// that it is 1pm for the London partner and 9pm for the one in Singapore before
// anybody has to reply with "could we do earlier?".
//
// A guest's zone is a best guess from what the firm already has: for a
// teammate, the zone of the meetings they schedule; for an outside guest, the
// zone they booked in through a scheduling link. Unknown is left unknown.
//
// Pure: no React, no Supabase.

import { hourInTimezone } from "@/lib/meetings/slot-groups";

/** Before this hour is early for somebody. */
export const DAY_STARTS = 8;
/** From this hour on is late for somebody. */
export const DAY_ENDS = 19;

/** "London" from "Europe/London", "New York" from "America/New_York", "UTC" as itself. */
export function zoneCity(timezone: string): string {
  const last = timezone.split("/").pop() ?? timezone;
  return last.replace(/_/g, " ");
}

const CLOCKS = new Map<string, Intl.DateTimeFormat>();

/** "3:00 PM" for an instant in a zone; the UTC clock for a zone this runtime does not know. */
export function zoneClock(iso: string, timezone: string): string {
  let fmt = CLOCKS.get(timezone);
  if (!fmt) {
    try {
      fmt = new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", timeZone: timezone });
    } catch {
      return new Date(iso).toISOString().slice(11, 16);
    }
    CLOCKS.set(timezone, fmt);
  }
  return fmt.format(new Date(iso));
}

/** Whether a start falls outside somebody's working day. */
export function hoursFlag(iso: string, timezone: string): "early" | "late" | null {
  const hour = hourInTimezone(iso, timezone);
  if (hour < DAY_STARTS) return "early";
  if (hour >= DAY_ENDS) return "late";
  return null;
}

export interface GuestTime {
  email: string;
  name: string;
  timezone: string;
  clock: string;
  city: string;
  flag: "early" | "late" | null;
}

/**
 * The guests whose zone is known and differs from the meeting's, with the
 * start in their own time. Somebody in the meeting's own zone reads the time
 * on the form already and needs no line.
 */
export function guestTimes(
  startIso: string,
  meetingTimezone: string,
  guests: readonly { email: string; name: string }[],
  zones: Readonly<Record<string, string>>,
): GuestTime[] {
  if (isNaN(new Date(startIso).getTime())) return [];
  const out: GuestTime[] = [];
  for (const g of guests) {
    const timezone = zones[g.email.toLowerCase()];
    if (!timezone || timezone === meetingTimezone) continue;
    out.push({
      email: g.email,
      name: g.name || g.email,
      timezone,
      clock: zoneClock(startIso, timezone),
      city: zoneCity(timezone),
      flag: hoursFlag(startIso, timezone),
    });
  }
  return out;
}

/** The first zone seen for each address, from rows newest first. Keys lower-cased. */
export function firstZoneByEmail(
  rows: readonly { email: string | null | undefined; timezone: string | null | undefined }[],
  isValid: (tz: string) => boolean,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const row of rows) {
    const email = row.email?.trim().toLowerCase();
    const tz = row.timezone?.trim();
    if (!email || !tz || out[email] || !isValid(tz)) continue;
    out[email] = tz;
  }
  return out;
}
