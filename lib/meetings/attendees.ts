export type MeetingAttendeeInput = {
  name: string;
  email?: string;
  type?: "internal" | "external";
};

const EMAIL_RE = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;

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
