import {
  applyRosterQuery,
  computeFacets,
  daysSinceContact,
  DEFAULT_ROSTER_QUERY,
  filterRoster,
  needsAttention,
  parseRosterQuery,
  sortRoster,
  STALE_AFTER_DAYS,
} from "@/lib/network-roster";
import { computePulse, type ActiveNetworkPerson } from "@/lib/network-active";

const NOW = Date.parse("2026-09-18T12:00:00.000Z");
const daysAgo = (n: number) => new Date(NOW - n * 86_400_000).toISOString();

function person(over: Partial<ActiveNetworkPerson> = {}): ActiveNetworkPerson {
  return {
    id: over.id ?? "id-1",
    kind: "contact",
    name: "Ada Lovelace",
    org: "Analytical Engines",
    role: "Managing Partner",
    category: "limited_partner",
    temperature: "warm",
    warmth: 50,
    committedAmount: 0,
    lastContactAt: null,
    lastContactDays: null,
    addedAt: daysAgo(100),
    nextAction: null,
    nextActionTier: null,
    introducer: null,
    introPath: null,
    thesisFitScore: null,
    email: "ada@example.com",
    stage: "engaged",
    ownerId: null,
    ownerName: null,
    visibility: "org",
    lastActivityAt: null,
    openTasks: 0,
    tags: [],
    ...over,
  };
}

describe("parseRosterQuery", () => {
  it("falls back to defaults for unrecognised values", () => {
    const q = parseRosterQuery(
      new URLSearchParams({ temp: "lukewarm", kind: "alien", stage: "nonsense", sort: "vibes" }),
    );
    expect(q.temp).toBe("all");
    expect(q.kind).toBe("all");
    expect(q.stage).toBe("all");
    expect(q.sort).toBe("warmth");
  });

  it("accepts the recognised values", () => {
    const q = parseRosterQuery(
      new URLSearchParams({ temp: "committed", kind: "investor", stage: "diligence", sort: "stale" }),
    );
    expect(q).toMatchObject({
      temp: "committed",
      kind: "investor",
      stage: "diligence",
      sort: "stale",
    });
  });

  it("bounds the page size and offset so a crafted URL cannot ask for everything", () => {
    expect(parseRosterQuery(new URLSearchParams({ limit: "100000" })).limit).toBe(100);
    expect(parseRosterQuery(new URLSearchParams({ limit: "-5" })).limit).toBe(1);
    expect(parseRosterQuery(new URLSearchParams({ limit: "abc" })).limit).toBe(30);
    expect(parseRosterQuery(new URLSearchParams({ offset: "-10" })).offset).toBe(0);
    expect(parseRosterQuery(new URLSearchParams({ offset: "999999999" })).offset).toBe(100_000);
  });

  it("truncates a long free-text query rather than passing it through", () => {
    const q = parseRosterQuery(new URLSearchParams({ q: "x".repeat(500) }));
    expect(q.q).toHaveLength(200);
  });

  it("reads the boolean flags", () => {
    const q = parseRosterQuery(new URLSearchParams({ committed: "1", intro: "true", attention: "1" }));
    expect(q.committedOnly).toBe(true);
    expect(q.introOnly).toBe(true);
    expect(q.needsAttention).toBe(true);
  });
});

describe("filterRoster", () => {
  const people = [
    person({ id: "a", name: "Ada Lovelace", temperature: "committed", stage: "committed", committedAmount: 5_000_000 }),
    person({ id: "b", name: "Grace Hopper", org: "Navy Labs", temperature: "warm", stage: "engaged" }),
    person({ id: "c", name: "Alan Turing", kind: "investor", temperature: "cold", stage: "prospect" }),
    person({
      id: "d",
      name: "Katherine Johnson",
      ownerId: "owner-1",
      tags: ["priority"],
      temperature: "active",
      stage: "diligence",
    }),
  ];

  it("matches free text across name, org, role, email, and tags", () => {
    expect(filterRoster(people, { ...DEFAULT_ROSTER_QUERY, q: "navy" }, NOW).map((p) => p.id)).toEqual(["b"]);
    expect(filterRoster(people, { ...DEFAULT_ROSTER_QUERY, q: "priority" }, NOW).map((p) => p.id)).toEqual(["d"]);
    expect(filterRoster(people, { ...DEFAULT_ROSTER_QUERY, q: "TURING" }, NOW).map((p) => p.id)).toEqual(["c"]);
  });

  it("filters by temperature, kind, and stage", () => {
    expect(filterRoster(people, { ...DEFAULT_ROSTER_QUERY, temp: "cold" }, NOW).map((p) => p.id)).toEqual(["c"]);
    expect(filterRoster(people, { ...DEFAULT_ROSTER_QUERY, kind: "investor" }, NOW).map((p) => p.id)).toEqual(["c"]);
    expect(filterRoster(people, { ...DEFAULT_ROSTER_QUERY, stage: "engaged" }, NOW).map((p) => p.id)).toEqual(["b"]);
  });

  it("distinguishes 'unassigned' from a specific owner", () => {
    expect(filterRoster(people, { ...DEFAULT_ROSTER_QUERY, owner: "owner-1" }, NOW).map((p) => p.id)).toEqual(["d"]);
    expect(filterRoster(people, { ...DEFAULT_ROSTER_QUERY, owner: "unassigned" }, NOW).map((p) => p.id)).toEqual([
      "a",
      "b",
      "c",
    ]);
  });

  it("filters to committed capital and to intro paths", () => {
    expect(filterRoster(people, { ...DEFAULT_ROSTER_QUERY, committedOnly: true }, NOW).map((p) => p.id)).toEqual(["a"]);

    const withPath = [...people, person({ id: "e", introPath: ["You", "Grace", "Target"] })];
    expect(filterRoster(withPath, { ...DEFAULT_ROSTER_QUERY, introOnly: true }, NOW).map((p) => p.id)).toEqual(["e"]);
  });

  it("combines filters conjunctively", () => {
    const rows = filterRoster(people, { ...DEFAULT_ROSTER_QUERY, temp: "warm", q: "grace" }, NOW);
    expect(rows.map((p) => p.id)).toEqual(["b"]);
    expect(filterRoster(people, { ...DEFAULT_ROSTER_QUERY, temp: "cold", q: "grace" }, NOW)).toEqual([]);
  });
});

describe("needsAttention", () => {
  it("flags an engaged relationship that has gone quiet", () => {
    expect(needsAttention(person({ temperature: "warm", lastActivityAt: daysAgo(STALE_AFTER_DAYS + 1) }), NOW)).toBe(
      true,
    );
  });

  it("does not flag one touched recently", () => {
    expect(needsAttention(person({ temperature: "warm", lastActivityAt: daysAgo(3) }), NOW)).toBe(false);
  });

  it("flags an engaged relationship with nothing logged at all", () => {
    // The gap this is meant to surface: warm on paper, never actually worked.
    expect(needsAttention(person({ temperature: "active", lastActivityAt: null, lastContactAt: null }), NOW)).toBe(
      true,
    );
  });

  it("never flags a cold contact — that is not a lapse, it is a cold contact", () => {
    expect(needsAttention(person({ temperature: "cold", lastActivityAt: null }), NOW)).toBe(false);
    expect(needsAttention(person({ temperature: "cold", lastActivityAt: daysAgo(900) }), NOW)).toBe(false);
  });

  it("falls back to lastContactAt when no timeline entry exists", () => {
    expect(daysSinceContact(person({ lastActivityAt: null, lastContactAt: daysAgo(10) }), NOW)).toBe(10);
    // A logged timeline entry outranks the scoring timestamp.
    expect(
      daysSinceContact(person({ lastActivityAt: daysAgo(2), lastContactAt: daysAgo(10) }), NOW),
    ).toBe(2);
  });
});

describe("sortRoster", () => {
  it("does not mutate the array it is given", () => {
    const people = [person({ id: "a", warmth: 10 }), person({ id: "b", warmth: 90 })];
    const before = people.map((p) => p.id);
    sortRoster(people, "warmth");
    expect(people.map((p) => p.id)).toEqual(before);
  });

  it("sorts by warmth, hottest first", () => {
    const rows = sortRoster(
      [person({ id: "a", warmth: 10 }), person({ id: "b", warmth: 90 }), person({ id: "c", warmth: 50 })],
      "warmth",
    );
    expect(rows.map((p) => p.id)).toEqual(["b", "c", "a"]);
  });

  it("puts a never-contacted relationship at the top of 'quietest first'", () => {
    const rows = sortRoster(
      [
        person({ id: "recent", lastActivityAt: daysAgo(1) }),
        person({ id: "never", lastActivityAt: null, lastContactAt: null }),
        person({ id: "old", lastActivityAt: daysAgo(400) }),
      ],
      "stale",
    );
    expect(rows.map((p) => p.id)).toEqual(["never", "old", "recent"]);
  });

  it("sorts by last name rather than by the whole string", () => {
    const rows = sortRoster(
      [person({ id: "a", name: "Zoe Adams" }), person({ id: "b", name: "Adam Zeller" })],
      "last",
    );
    expect(rows.map((p) => p.id)).toEqual(["a", "b"]);
  });
});

describe("computePulse", () => {
  it("counts the whole roster, not just investors", () => {
    // The bug this replaces: `people` counted every source while engaged and
    // committed counted only the capital map, so the two disagreed.
    const people = [
      person({ id: "a", kind: "investor", temperature: "committed" }),
      person({ id: "b", kind: "contact", temperature: "active" }),
      person({ id: "c", kind: "partner", temperature: "warm" }),
      person({ id: "d", kind: "provider", temperature: "cold" }),
    ];
    expect(computePulse(people)).toEqual({
      people: 4,
      committed: 1,
      engaged: 3,
      temperature: { cold: 1, warm: 1, active: 1, committed: 1 },
    });
  });

  it("treats a person with no temperature as cold rather than dropping them", () => {
    const pulse = computePulse([person({ temperature: null })]);
    expect(pulse.people).toBe(1);
    expect(pulse.temperature.cold).toBe(1);
  });
});

describe("applyRosterQuery", () => {
  const people = Array.from({ length: 75 }, (_, i) =>
    person({ id: `p${i}`, name: `Person ${i}`, warmth: 100 - i, temperature: i < 10 ? "committed" : "warm" }),
  );

  it("returns one page and the offset for the next", () => {
    const page = applyRosterQuery(people, { ...DEFAULT_ROSTER_QUERY, limit: 30 }, undefined, NOW);
    expect(page.rows).toHaveLength(30);
    expect(page.total).toBe(75);
    expect(page.nextOffset).toBe(30);
  });

  it("reports no next offset on the last page", () => {
    const page = applyRosterQuery(people, { ...DEFAULT_ROSTER_QUERY, offset: 60, limit: 30 }, undefined, NOW);
    expect(page.rows).toHaveLength(15);
    expect(page.nextOffset).toBeNull();
  });

  it("handles an offset past the end without throwing", () => {
    const page = applyRosterQuery(people, { ...DEFAULT_ROSTER_QUERY, offset: 5_000 }, undefined, NOW);
    expect(page.rows).toEqual([]);
    expect(page.nextOffset).toBeNull();
    expect(page.total).toBe(75);
  });

  it("facets the filtered set, not the page — the chips describe the result", () => {
    const page = applyRosterQuery(people, { ...DEFAULT_ROSTER_QUERY, limit: 5 }, undefined, NOW);
    expect(page.rows).toHaveLength(5);
    expect(page.facets.temperature.committed).toBe(10);
    expect(page.facets.temperature.warm).toBe(65);
  });

  it("keeps the pulse over the whole roster while the page is filtered", () => {
    const page = applyRosterQuery(people, { ...DEFAULT_ROSTER_QUERY, temp: "committed" }, undefined, NOW);
    expect(page.total).toBe(10);
    expect(page.pulse.people).toBe(75);
  });
});

describe("computeFacets", () => {
  it("ranks categories by count", () => {
    const facets = computeFacets(
      [
        person({ id: "a", category: "limited_partner" }),
        person({ id: "b", category: "limited_partner" }),
        person({ id: "c", category: "family_office" }),
      ],
      NOW,
    );
    expect(facets.categories).toEqual([
      { value: "limited_partner", count: 2 },
      { value: "family_office", count: 1 },
    ]);
  });
});
