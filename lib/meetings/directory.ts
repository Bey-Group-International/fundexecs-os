// lib/meetings/directory.ts
// Turning an attendee somebody typed into an address an invitation can reach.
//
// Meeting attendees are entered as free text — "Internal attendees" is a box
// that says "Add people", and people put names in it. parseAttendeeInput keeps
// an address when one is written ("Jane Doe <jane@fund.test>"), but a bare name
// carries none, and an attendee with no address is an attendee nobody emails.
// The meeting was scheduled, the invitation went to the guests who happened to
// be typed with an "@" in them, and a teammate on the same meeting heard
// nothing.
//
// The organization already knows those addresses: every member is a principal
// with a name and an email. This module matches the typed text against that
// directory, and reports what it could not place so the host can be told rather
// than left assuming.
//
// Matching is exact and unique-or-nothing. Two people called "Jane Doe" resolve
// to neither of them: emailing a meeting to the wrong colleague is worse than
// emailing nobody and saying so.
//
// Pure. The directory is loaded in directory.server.ts.
import type { MeetingAttendeeInput } from "@/lib/meetings/attendees";

/** A member of the organization, as the directory knows them. */
export interface DirectoryMember {
  name: string | null;
  email: string;
}

export interface AttendeeResolution {
  /** The attendee list, in order, with addresses filled in where one was found. */
  attendees: MeetingAttendeeInput[];
  /** How many attendees gained an address they did not arrive with. */
  resolved: number;
  /** Display names still with no address — nobody will email these. */
  unreachable: string[];
}

/** Comparison form: case-folded, punctuation-light, single-spaced. */
function key(value: string | null | undefined): string {
  return (value ?? "")
    .toLowerCase()
    .replace(/[.,_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** The part of an address before the "@", as a comparable name. */
function localPart(email: string): string {
  return key(email.split("@")[0] ?? "");
}

/** The first word of a name, for the looser internal-teammate match. */
function firstName(value: string): string {
  return key(value).split(" ")[0] ?? "";
}

/**
 * Index the directory by the forms a host might type, collecting every address
 * each form could mean.
 *
 * Every form shares one index rather than being tried in turn, so a name that
 * two people answer to stays ambiguous even when one of them also spells it in
 * their address. Ambiguity has to be decided across the whole directory, not
 * per lookup, or the tie is broken by whichever form happened to be tried
 * first — which is exactly how an invitation reaches the wrong colleague.
 */
function indexBy(
  members: readonly DirectoryMember[],
  forms: ReadonlyArray<(m: DirectoryMember) => string>,
): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  for (const member of members) {
    const email = member.email.trim().toLowerCase();
    if (!email) continue;
    for (const form of forms) {
      const k = form(member);
      if (!k) continue;
      const bucket = out.get(k);
      if (bucket) bucket.add(email);
      else out.set(k, new Set([email]));
    }
  }
  return out;
}

/** The one address this form can mean, or undefined when it means none or many. */
function only(index: Map<string, Set<string>>, form: string): string | undefined {
  const bucket = form ? index.get(form) : undefined;
  return bucket && bucket.size === 1 ? [...bucket][0] : undefined;
}

/**
 * Fill in the addresses of attendees who were entered by name alone.
 *
 * An attendee who already has an address keeps it — the host wrote it, and a
 * same-named colleague must not displace it. Otherwise the typed text is looked
 * up as an identity (the full name as the directory spells it, an address, or
 * the part of one before the "@") and, failing that, as a first name — the
 * looser form, allowed only for an attendee marked internal, because that is
 * the field where "Mike" means the Mike on the team.
 *
 * Either way the match must be unique. A form two people answer to resolves to
 * neither, and they are reported unreachable instead.
 */
export function resolveAttendeeDirectory(
  attendees: readonly MeetingAttendeeInput[] | null | undefined,
  directory: readonly DirectoryMember[] | null | undefined,
): AttendeeResolution {
  const list = [...(attendees ?? [])];
  const members = (directory ?? []).filter((m) => !!m.email?.trim());

  // Everything that names a person outright: how the directory spells them,
  // their address, and the part of it before the "@".
  const byIdentity = indexBy(members, [
    (m) => key(m.name),
    (m) => m.email.trim().toLowerCase(),
    (m) => localPart(m.email),
  ]);
  // First names are indexed apart because they are the loose form, used only
  // where the host said the attendee is on the team.
  const byFirstName = indexBy(members, [(m) => firstName(m.name ?? "")]);

  let resolved = 0;
  const unreachable: string[] = [];

  const out = list.map((attendee) => {
    if (attendee.email?.trim()) return attendee;

    const typed = key(attendee.name);
    const found =
      only(byIdentity, typed) ??
      // A whole address, which `key` would have split on its dots.
      only(byIdentity, (attendee.name ?? "").trim().toLowerCase()) ??
      (attendee.type === "internal" ? only(byFirstName, typed) : undefined);

    if (!found) {
      const label = (attendee.name ?? "").trim();
      if (label) unreachable.push(label);
      return attendee;
    }

    resolved += 1;
    return { ...attendee, email: found };
  });

  return { attendees: out, resolved, unreachable };
}

/** Whether any attendee still needs an address looked up. */
export function needsDirectory(attendees: readonly MeetingAttendeeInput[] | null | undefined): boolean {
  return (attendees ?? []).some((a) => !a.email?.trim() && !!a.name?.trim());
}
