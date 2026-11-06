// lib/meetings/call-organise.ts
// Keeping a library of recorded calls findable once it is more than a page:
// tags ("LP", "diligence"), who was on the call, and the deal it was about —
// and the filters those make possible.
//
// Pure: no React, no Supabase. Everything a person types passes through here
// before it is stored or matched.

export const MAX_TAGS = 8;
export const TAG_MAX = 32;
export const MAX_PEOPLE = 10;
export const PERSON_MAX = 80;

function clean(text: string, max: number): string {
  return text.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, max).trim();
}

/** Split typed input — "lp, diligence" — or take a list as given. */
function items(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw.filter((v): v is string => typeof v === "string");
  if (typeof raw === "string") return raw.split(/[,;\n]/);
  return [];
}

/** Tags as stored: trimmed, no leading #, distinct regardless of case, capped. */
export function cleanCallTags(raw: unknown): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of items(raw)) {
    const tag = clean(item.replace(/^#+/, ""), TAG_MAX);
    if (!tag || seen.has(tag.toLowerCase())) continue;
    seen.add(tag.toLowerCase());
    out.push(tag);
    if (out.length >= MAX_TAGS) break;
  }
  return out;
}

/** Who was on the call, as names: trimmed, distinct regardless of case, capped. */
export function cleanCallPeople(raw: unknown): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of items(raw)) {
    const name = clean(item, PERSON_MAX);
    if (!name || seen.has(name.toLowerCase())) continue;
    seen.add(name.toLowerCase());
    out.push(name);
    if (out.length >= MAX_PEOPLE) break;
  }
  return out;
}

/** A stored attendees value read back into names. */
export function peopleFromAttendees(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return cleanCallPeople(
    raw.map((a) => {
      if (typeof a === "string") return a;
      if (a && typeof a === "object") {
        const o = a as Record<string, unknown>;
        return typeof o.name === "string" && o.name.trim() ? o.name : typeof o.email === "string" ? o.email : "";
      }
      return "";
    }),
  );
}

/** Names as the attendees column stores them. */
export function attendeesFromPeople(people: readonly string[]): Array<{ name: string; type: "external" }> {
  return people.map((name) => ({ name, type: "external" as const }));
}

export interface Organised {
  tags?: string[];
  people?: string[];
  dealId?: string | null;
  dealName?: string | null;
}

export interface Facet {
  value: string;
  label: string;
  count: number;
}

export interface CallFacets {
  tags: Facet[];
  people: Facet[];
  deals: Facet[];
}

function rank(map: Map<string, Facet>): Facet[] {
  return [...map.values()].sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}

/** The tags, people and deals among the calls loaded, most used first. */
export function facetsOf(calls: readonly Organised[]): CallFacets {
  const tags = new Map<string, Facet>();
  const people = new Map<string, Facet>();
  const deals = new Map<string, Facet>();
  const bump = (map: Map<string, Facet>, value: string, label: string) => {
    const f = map.get(value);
    if (f) f.count += 1;
    else map.set(value, { value, label, count: 1 });
  };
  for (const c of calls) {
    for (const t of c.tags ?? []) bump(tags, t.toLowerCase(), t);
    for (const p of c.people ?? []) bump(people, p.toLowerCase(), p);
    if (c.dealId) bump(deals, c.dealId, c.dealName || "Deal");
  }
  return { tags: rank(tags), people: rank(people), deals: rank(deals) };
}

export interface FacetFilter {
  tag: string | null;
  person: string | null;
  dealId: string | null;
}

export const NO_FACETS: FacetFilter = { tag: null, person: null, dealId: null };

/** Whether a call passes the chosen tag, person and deal. */
export function passesFacets(call: Organised, f: FacetFilter): boolean {
  if (f.tag && !(call.tags ?? []).some((t) => t.toLowerCase() === f.tag)) return false;
  if (f.person && !(call.people ?? []).some((p) => p.toLowerCase() === f.person)) return false;
  if (f.dealId && call.dealId !== f.dealId) return false;
  return true;
}

/** A tag added to a call's tags, as the bulk action applies it. */
export function withTag(tags: readonly string[] | undefined, tag: string): string[] {
  return cleanCallTags([...(tags ?? []), tag]);
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function isUuid(v: unknown): v is string {
  return typeof v === "string" && UUID.test(v);
}
