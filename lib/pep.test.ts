import { PEP_SCREEN_PREFIX, parsePepResponse, pepConfig, pepOutcome, pepQueries, pepRequestBody } from "@/lib/pep";

const NOW = Date.parse("2026-11-02T10:00:00Z");
const subjects = [
  { role: "the LP", name: "Acme Capital LP" },
  { role: "signatory", name: "  Jo   Bloggs " },
  { role: "owner", name: "jo bloggs" }, // the same person again
  { role: "owner", name: "X" }, // too short
  { role: "controller", name: "Ana Pérez" },
];

describe("pepConfig", () => {
  it("is off without a key", () => {
    expect(pepConfig({})).toBeNull();
    expect(pepConfig({ PEP_SCREEN_API_KEY: "  " })).toBeNull();
  });
  it("defaults to the OpenSanctions API and the peps dataset", () => {
    expect(pepConfig({ PEP_SCREEN_API_KEY: "k" })).toEqual({ apiUrl: "https://api.opensanctions.org", dataset: "peps", apiKey: "k" });
  });
  it("takes a custom endpoint and dataset, trimming a trailing slash", () => {
    expect(pepConfig({ PEP_SCREEN_API_KEY: "k", PEP_SCREEN_API_URL: "https://screen.example.com/", PEP_SCREEN_DATASET: "my_peps" })).toEqual({
      apiUrl: "https://screen.example.com",
      dataset: "my_peps",
      apiKey: "k",
    });
  });
  it("refuses an endpoint that is not https, and a dataset that could change the URL path", () => {
    expect(pepConfig({ PEP_SCREEN_API_KEY: "k", PEP_SCREEN_API_URL: "http://screen.example.com" })).toBeNull();
    expect(pepConfig({ PEP_SCREEN_API_KEY: "k", PEP_SCREEN_API_URL: "not a url" })).toBeNull();
    expect(pepConfig({ PEP_SCREEN_API_KEY: "k", PEP_SCREEN_DATASET: "../admin" })).toBeNull();
  });
});

describe("pepQueries / pepRequestBody", () => {
  it("sends each distinct name once, drops ones too short, and marks the LP as a generic entity", () => {
    const q = pepQueries(subjects);
    expect(q.map((x) => x.subject.name)).toEqual(["Acme Capital LP", "Jo Bloggs", "Ana Pérez"]);
    expect(q.map((x) => x.schema)).toEqual(["LegalEntity", "Person", "Person"]);
  });
  it("puts only names in the request body", () => {
    const body = pepRequestBody(pepQueries(subjects));
    expect(body).toEqual({
      queries: {
        q0: { schema: "LegalEntity", properties: { name: ["Acme Capital LP"] } },
        q1: { schema: "Person", properties: { name: ["Jo Bloggs"] } },
        q2: { schema: "Person", properties: { name: ["Ana Pérez"] } },
      },
    });
    expect(Object.keys(JSON.stringify(body).match(/"properties":\{"[a-z]+"/g) ?? []).length).toBe(3);
    expect(JSON.stringify(body)).not.toMatch(/email|address|birth|amount|fund/i);
  });
  it("caps how many names go out", () => {
    const many = Array.from({ length: 80 }, (_, i) => ({ role: "owner", name: `Person Number${i}` }));
    expect(pepQueries(many)).toHaveLength(50);
  });
});

describe("parsePepResponse", () => {
  const queries = pepQueries(subjects);
  const answer = (over: Record<string, unknown> = {}) => ({
    responses: {
      q0: { results: [] },
      q1: { results: [{ caption: "Joseph Bloggs", score: 0.92, match: true, properties: { topics: ["role.pep"] } }] },
      q2: { results: [] },
      ...over,
    },
  });
  const parse = (j: unknown) => parsePepResponse(j, queries, { dataset: "peps", now: NOW });

  it("reads who resembles whom, and only PEP-type topics", () => {
    const r = parse(answer())!;
    expect(r.flagged).toBe(1);
    expect(r.results[1].matches).toEqual([{ caption: "Joseph Bloggs", score: 0.92, topics: ["role.pep"] }]);
    expect(r.screenedOn).toBe("2026-11-02");
  });
  it("ignores a candidate that is not politically exposed (a sanctions hit belongs to the sanctions check)", () => {
    const r = parse(answer({ q1: { results: [{ caption: "Joe Bloggs", score: 0.99, match: true, properties: { topics: ["sanction"] } }] } }))!;
    expect(r.flagged).toBe(0);
  });
  it("flags a relative or close associate", () => {
    const r = parse(answer({ q2: { results: [{ caption: "Ana Perez", score: 0.8, properties: { topics: ["role.rca"] } }] } }))!;
    expect(r.results[2].matches[0].topics).toEqual(["role.rca"]);
  });
  it("flags on the provider's own match verdict even at a low score, and on a high score without it, but not a weak non-match", () => {
    const make = (c: object) => parse(answer({ q1: { results: [{ caption: "A", properties: { topics: ["role.pep"] }, ...c }] } }))!.flagged;
    expect(make({ match: true, score: 0.3 })).toBe(1);
    expect(make({ match: false, score: 0.75 })).toBe(1);
    expect(make({ match: false, score: 0.4 })).toBe(0);
  });
  it("keeps the best three matches per name", () => {
    const results = [0.71, 0.9, 0.8, 0.75].map((score, i) => ({ caption: `P${i}`, score, properties: { topics: ["role.pep"] } }));
    const r = parse(answer({ q1: { results } }))!;
    expect(r.results[1].matches.map((m) => m.score)).toEqual([0.9, 0.8, 0.75]);
  });
  it("returns null, never an empty result, when the answer is unreadable or leaves a name unanswered", () => {
    expect(parse(null)).toBeNull();
    expect(parse({})).toBeNull();
    expect(parse({ responses: { q0: { results: [] } } })).toBeNull();
    expect(parse(answer({ q2: { oops: true } }))).toBeNull();
    expect(parse({ responses: "no" })).toBeNull();
  });
});

describe("pepOutcome", () => {
  const base = { provider: "opensanctions", dataset: "peps", screenedOn: "2026-11-02" };
  it("is never 'clear': no match leaves the check pending, with a note that says so", () => {
    const o = pepOutcome({ ...base, flagged: 0, results: [{ subject: { role: "owner", name: "A B" }, matches: [] }] });
    expect(o.status).toBe("pending");
    expect(o.summary).toMatch(new RegExp(`^${PEP_SCREEN_PREFIX}`));
    expect(o.summary).toMatch(/Not a clearance/);
  });
  it("flags with who resembles whom and why", () => {
    const o = pepOutcome({
      ...base,
      flagged: 1,
      results: [{ subject: { role: "owner", name: "Jo Bloggs" }, matches: [{ caption: "Joseph Bloggs", score: 0.9, topics: ["role.pep"] }, { caption: "J Bloggs", score: 0.8, topics: ["role.rca"] }] }],
    });
    expect(o.status).toBe("flagged");
    expect(o.summary).toMatch(/Jo Bloggs \(owner\) resembles Joseph Bloggs \[politically exposed\] \+1 more/);
  });
  it("stays within the 500 characters a check note may hold", () => {
    const results = Array.from({ length: 30 }, (_, i) => ({ subject: { role: "owner", name: `Person Number ${i}` }, matches: [{ caption: "A Very Long Caption Indeed", score: 0.9, topics: ["role.pep"] }] }));
    expect(pepOutcome({ ...base, flagged: 30, results }).summary.length).toBeLessThanOrEqual(480);
  });
});
