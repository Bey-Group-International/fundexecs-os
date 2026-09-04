export type MeetingAttendeeInput = {
  name: string;
  email?: string;
  type?: "internal" | "external";
};

const EMAIL_RE = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;

/**
 * Coerce an untrusted `attendees` array from a request body into real
 * attendees, or refuse it.
 *
 * The routes used to cast the parsed JSON straight to MeetingAttendeeInput[],
 * which is a promise TypeScript cannot keep: a body of `{"attendees":[null]}`
 * then reached code that reads `.email` off each element and threw, answering
 * 500 to what is really a malformed request. Anything that is not an object
 * with a usable name is rejected here so the caller can say 422 instead.
 *
 * Deliberately strict about shape and forgiving about content: an attendee with
 * no address is normal and stays, because resolving or reporting those is
 * exactly what the directory step is for.
 */
export function normalizeAttendees(value: unknown): MeetingAttendeeInput[] | null {
  if (!Array.isArray(value)) return null;

  const out: MeetingAttendeeInput[] = [];
  for (const raw of value) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
    const entry = raw as Record<string, unknown>;

    const name = typeof entry.name === "string" ? entry.name.trim() : "";
    const email = typeof entry.email === "string" ? entry.email.trim().toLowerCase() : "";
    // Something has to identify the person. A row with neither is not an
    // attendee, it is a stray object.
    if (!name && !email) return null;

    out.push({
      name: name || email,
      ...(email && EMAIL_RE.test(email) ? { email } : {}),
      type: entry.type === "internal" ? "internal" : "external",
    });
  }

  return out.slice(0, 100);
}

export function formatAttendeeInput(attendees: MeetingAttendeeInput[] | null | undefined): string {
  return (attendees ?? [])
    .map((attendee) => attendee.email ? `${attendee.name} <${attendee.email}>` : attendee.name)
    .join(", ");
}

export function parseAttendeeInput(value: string): MeetingAttendeeInput[] {
  const seen = new Set<string>();
  return value
    .split(/[,;\n]/)
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry): MeetingAttendeeInput => {
      const bracketMatch = entry.match(/^(.*?)<([^>]+)>$/);
      if (bracketMatch) {
        const name = bracketMatch[1].trim();
        const email = bracketMatch[2].trim().toLowerCase();
        return {
          name: name || email,
          ...(EMAIL_RE.test(email) ? { email } : {}),
          type: "external",
        };
      }

      const normalized = entry.toLowerCase();
      if (EMAIL_RE.test(normalized)) {
        const local = normalized.split("@")[0]?.replace(/[._-]+/g, " ").trim();
        return {
          name: local ? local.replace(/\b\w/g, (c) => c.toUpperCase()) : normalized,
          email: normalized,
          type: "external",
        };
      }

      return { name: entry, type: "external" };
    })
    .filter((attendee) => {
      const key = attendee.email ?? attendee.name.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 100);
}
