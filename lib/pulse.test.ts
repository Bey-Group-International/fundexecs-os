import {
  alertCopy,
  digestCopy,
  digestEmailHtml,
  planNotices,
  splitByFit,
  PULSE_ALERT_THRESHOLD,
  PULSE_DIGEST_SIZE,
  PULSE_SHOW_THRESHOLD,
  hasSearchableMandate,
  mandateBrief,
  normalizeFindings,
  parseJsonArray,
  pulseUserPrompt,
  remainingSearches,
  sweepIsDue,
  PULSE_DAILY_SEARCH_CAP,
  PULSE_MAX_ITEMS_PER_RUN,
  type PulseMandate,
} from "@/lib/pulse";

const THESIS: PulseMandate = {
  thesis: {
    title: "Sun Belt multifamily value-add",
    summary: "Workforce housing in growth metros",
    asset_classes: ["multifamily"],
    geographies: ["Texas", "Florida"],
    check_size_min: 5_000_000,
    check_size_max: 25_000_000,
    target_irr: 18,
    target_moic: 2,
  },
  scope: null,
};

function finding(over: Record<string, unknown> = {}) {
  return {
    kind: "deal",
    entity_name: "Acme Residential",
    headline: "Acme lists a 300-unit Austin portfolio",
    take: "Worth a look — basis looks below replacement cost.",
    why_it_fits: "Texas multifamily in the check range.",
    source_url: "https://news.example.com/acme",
    source_title: "Example News",
    fit_score: 82,
    ...over,
  };
}

describe("remainingSearches", () => {
  it("counts down from the daily cap and never goes negative", () => {
    expect(remainingSearches(0)).toBe(PULSE_DAILY_SEARCH_CAP);
    expect(remainingSearches(3)).toBe(PULSE_DAILY_SEARCH_CAP - 3);
    expect(remainingSearches(99)).toBe(0);
    expect(remainingSearches(NaN)).toBe(PULSE_DAILY_SEARCH_CAP);
  });
});

describe("sweepIsDue", () => {
  const now = new Date("2026-10-02T12:00:00Z");
  it("is due with no prior sweep or one at least a day old", () => {
    expect(sweepIsDue(null, now)).toBe(true);
    expect(sweepIsDue("2026-10-01T11:59:00Z", now)).toBe(true);
    expect(sweepIsDue("garbage", now)).toBe(true);
  });
  it("is not due within 24 hours", () => {
    expect(sweepIsDue("2026-10-02T01:00:00Z", now)).toBe(false);
  });
});

describe("mandate", () => {
  it("needs a thesis or scope to search against", () => {
    expect(hasSearchableMandate(THESIS)).toBe(true);
    expect(hasSearchableMandate({ thesis: null, scope: "Lower-middle-market industrials" })).toBe(true);
    expect(hasSearchableMandate({ thesis: null, scope: "  " })).toBe(false);
  });

  it("briefs the model on the thesis", () => {
    const brief = mandateBrief(THESIS);
    expect(brief).toMatch(/Sun Belt multifamily/);
    expect(brief).toMatch(/Geographies: Texas, Florida/);
    expect(brief).toMatch(/Check size: \$5M–\$25M/);
  });

  it("tells the model what to skip", () => {
    const prompt = pulseUserPrompt({
      mandate: THESIS,
      existingNames: ["Acme Residential"],
      dismissedHeadlines: ["Office tower in Chicago"],
      today: new Date("2026-10-02T00:00:00Z"),
    });
    expect(prompt).toMatch(/Today is 2026-10-02/);
    expect(prompt).toMatch(/do not repeat\): Acme Residential/);
    expect(prompt).toMatch(/Office tower in Chicago/);
  });
});

describe("parseJsonArray", () => {
  it("reads a bare or fenced array", () => {
    expect(parseJsonArray('[{"a":1}]')).toEqual([{ a: 1 }]);
    expect(parseJsonArray('Here you go:\n```json\n[{"a":2}]\n```')).toEqual([{ a: 2 }]);
  });
  it("returns null when there's no array", () => {
    expect(parseJsonArray("nothing found")).toBeNull();
    expect(parseJsonArray("[not json")).toBeNull();
  });
});

describe("normalizeFindings", () => {
  it("keeps a well-formed, sourced finding", () => {
    const [f] = normalizeFindings([finding()], []);
    expect(f).toMatchObject({ kind: "deal", entity_name: "Acme Residential", fit_score: 82 });
    expect(f.dedupe_key).toBeTruthy();
  });

  it("drops items without a source, name, valid kind, or with a LinkedIn source", () => {
    expect(
      normalizeFindings(
        [
          finding({ source_url: null }),
          finding({ source_url: "javascript:alert(1)" }),
          finding({ source_url: "https://www.linkedin.com/company/acme" }),
          finding({ entity_name: "" }),
          finding({ kind: "rumor" }),
        ],
        [],
      ),
    ).toEqual([]);
  });

  it("drops prose that carries contact details", () => {
    expect(normalizeFindings([finding({ take: "Email jane@acme.com today" })], [])).toEqual([]);
  });

  it("skips names the firm already tracks and duplicates within a run", () => {
    expect(normalizeFindings([finding()], ["Acme Residential LLC"])).toEqual([]);
    expect(normalizeFindings([finding(), finding({ headline: "Same firm again" })], [])).toHaveLength(1);
  });

  it("clamps scores and caps the run size", () => {
    const [f] = normalizeFindings([finding({ fit_score: 140 })], []);
    expect(f.fit_score).toBe(100);
    const many = Array.from({ length: 20 }, (_, i) => finding({ entity_name: `Firm ${String.fromCharCode(65 + i)} Holdings` }));
    expect(normalizeFindings(many, [])).toHaveLength(PULSE_MAX_ITEMS_PER_RUN);
  });
});

const f = (entity_name: string, fit_score: number | null, kind: "deal" | "investment" | "investor" = "deal") => ({
  kind,
  entity_name,
  headline: `${entity_name} news`,
  take: "Worth a look.",
  fit_score,
  source_url: "https://example.com/x",
});

describe("splitByFit", () => {
  it("tucks findings below the threshold under Show more; unscored stay visible", () => {
    const { shown, more } = splitByFit([f("A", PULSE_SHOW_THRESHOLD), f("B", PULSE_SHOW_THRESHOLD - 1), f("C", null)]);
    expect(shown.map((x) => x.entity_name)).toEqual(["A", "C"]);
    expect(more.map((x) => x.entity_name)).toEqual(["B"]);
  });
});

describe("planNotices", () => {
  it("alerts high fits and digests the best of the rest", () => {
    const items = [f("Low", 40), f("Top", 95), f("Mid", 70), f("High", PULSE_ALERT_THRESHOLD), f("Ok", 65)];
    const { alerts, digest } = planNotices(items);
    expect(alerts.map((x) => x.entity_name)).toEqual(["Top", "High"]);
    expect(digest.map((x) => x.entity_name)).toEqual(["Mid", "Ok", "Low"]);
    expect(digest).toHaveLength(PULSE_DIGEST_SIZE);
  });
});

describe("notice copy", () => {
  it("writes an alert and a digest", () => {
    expect(alertCopy(f("Acme", 91)).subject).toBe("High-fit Pulse find: Acme");
    const d = digestCopy([f("A", 70), f("B", 65)], 5)!;
    expect(d.subject).toBe("Market Pulse: 5 new findings today");
    expect(d.body).toMatch(/\+3 more in Market Pulse/);
    expect(digestCopy([], 0)).toBeNull();
  });

  it("escapes HTML in the email", () => {
    const html = digestEmailHtml([f("<script>", 70)], 1, "https://app.example.com/pulse");
    expect(html).not.toMatch(/<script>/);
    expect(html).toMatch(/&lt;script&gt;/);
    expect(html).toMatch(/href="https:\/\/app.example.com\/pulse"/);
  });
});
