// lib/radar-digest.test.ts
// Unit tests for the PURE Act-now Radar digest composer and the mock-mode Slack
// adapter. The composer must be deterministic and channel-correct; the Slack
// adapter must degrade to a well-formed mock result when unconfigured (never
// throw, never go live without credentials).
import { composeDigest, selectDigestItems } from "./radar-digest";
import { isPrefDue } from "./radar-send";
import { slackAdapter } from "./integrations/adapters/slack";
import type { RadarItem } from "./source-radar";
import type { Propensity } from "./sourcing-signals";

const prop: Propensity = { sell: 0, raise: 0 };

function item(name: string, score: number, over: Partial<RadarItem> = {}): RadarItem {
  return {
    entityId: `e-${name}`,
    name,
    kind: "company",
    categories: [],
    geography: null,
    description: null,
    sourceUrl: null,
    inPipeline: false,
    fit: 50,
    propensity: prop,
    signalCount: 1,
    signalSummary: `${name} signal`,
    recency: 50,
    score,
    move: { label: "Find buyers", kind: "buyers", href: `/source/buyers?q=${name}` },
    ...over,
  };
}

describe("selectDigestItems", () => {
  it("filters out items below the min-score bar", () => {
    const out = selectDigestItems([item("A", 80), item("B", 40)], { minScore: 60 });
    expect(out.map((i) => i.name)).toEqual(["A"]);
  });

  it("ranks highest-score first, breaking ties by name for determinism", () => {
    const out = selectDigestItems(
      [item("Zeta", 70), item("Alpha", 70), item("Mid", 90)],
      { minScore: 0 },
    );
    expect(out.map((i) => i.name)).toEqual(["Mid", "Alpha", "Zeta"]);
  });

  it("caps to the limit", () => {
    const items = [item("A", 90), item("B", 85), item("C", 80), item("D", 75)];
    expect(selectDigestItems(items, { minScore: 0, limit: 2 })).toHaveLength(2);
  });

  it("absolutizes relative move hrefs when a baseUrl is given", () => {
    const [row] = selectDigestItems([item("A", 90)], {
      minScore: 0,
      baseUrl: "https://app.test/",
    });
    expect(row.moveHref).toBe("https://app.test/source/buyers?q=A");
  });

  it("leaves already-absolute hrefs untouched", () => {
    const [row] = selectDigestItems(
      [item("A", 90, { move: { label: "Go", kind: "buyers", href: "https://x.test/y" } })],
      { minScore: 0, baseUrl: "https://app.test" },
    );
    expect(row.moveHref).toBe("https://x.test/y");
  });

  it("keeps a null href for inline (hrefless) moves", () => {
    const [row] = selectDigestItems(
      [item("A", 90, { move: { label: "Add to pipeline", kind: "pipeline" } })],
      { minScore: 0 },
    );
    expect(row.moveHref).toBeNull();
  });
});

describe("composeDigest", () => {
  const items = [item("Acme", 88), item("Beacon", 72), item("Below", 30)];

  it("produces a count, all channel bodies, and top items", () => {
    const d = composeDigest(items, { minScore: 60 });
    expect(d.count).toBe(2);
    expect(d.topItems.map((i) => i.name)).toEqual(["Acme", "Beacon"]);
    expect(d.slackMarkdown).toContain("Acme");
    expect(d.emailBody.html).toContain("<ol>");
    expect(d.emailBody.text).toContain("Acme");
    expect(d.inAppSummary).toContain("Acme");
  });

  it("renders Slack mrkdwn links for moves with an href", () => {
    const d = composeDigest(items, { minScore: 60, baseUrl: "https://app.test" });
    expect(d.slackMarkdown).toContain("<https://app.test/source/buyers?q=Acme|Find buyers>");
  });

  it("HTML-escapes names and links in the email body", () => {
    const d = composeDigest([item("A & <Co>", 90)], { minScore: 0 });
    expect(d.emailBody.html).toContain("A &amp; &lt;Co&gt;");
    expect(d.emailBody.html).not.toContain("<Co>");
  });

  it("handles the empty state without throwing", () => {
    const d = composeDigest([], { minScore: 60 });
    expect(d.count).toBe(0);
    expect(d.slackMarkdown).toContain("quiet");
    expect(d.emailSubject).toContain("quiet");
    expect(d.emailBody.text).toContain("quiet");
    expect(d.topItems).toEqual([]);
  });

  it("reflects the cadence label in headings and subject", () => {
    const d = composeDigest(items, { minScore: 60, cadence: "weekly" });
    expect(d.emailSubject).toContain("Weekly");
    expect(d.slackMarkdown).toContain("Weekly");
  });

  it("is deterministic: same input yields byte-identical output", () => {
    const a = composeDigest(items, { minScore: 60, baseUrl: "https://app.test" });
    const b = composeDigest(items, { minScore: 60, baseUrl: "https://app.test" });
    expect(a).toEqual(b);
  });

  // A/B subject-line override (lib/digest-experiments). Default compose (no
  // subject) must stay byte-identical; an override replaces the email subject
  // AND the Slack header but nothing else.
  describe("subject-line variant override", () => {
    it("default compose (no subject) is unchanged by the new option", () => {
      const withOpt = composeDigest(items, { minScore: 60, baseUrl: "https://app.test" });
      // The option key simply being absent must equal omitting it entirely.
      const without = composeDigest(items, {
        minScore: 60,
        baseUrl: "https://app.test",
        subject: undefined,
      });
      expect(withOpt).toEqual(without);
      // And the default subject is still the original derived one.
      expect(withOpt.emailSubject).toContain("Act-now Radar");
    });

    it("overrides the email subject and Slack header, leaving rows intact", () => {
      const def = composeDigest(items, { minScore: 60 });
      const over = composeDigest(items, { minScore: 60, subject: "Act now: 2 moves" });
      expect(over.emailSubject).toBe("Act now: 2 moves");
      expect(over.slackMarkdown).toContain("Act now: 2 moves");
      // Items + bodies (beyond the header line) are unchanged.
      expect(over.topItems).toEqual(def.topItems);
      expect(over.count).toBe(def.count);
      expect(over.emailBody.html).toBe(def.emailBody.html);
    });
  });
});

describe("isPrefDue", () => {
  const now = Date.UTC(2026, 5, 22, 13, 0, 0);

  it("is due when never sent", () => {
    expect(isPrefDue({ cadence: "daily" }, null, now)).toBe(true);
  });

  it("daily is not due an hour after the last send", () => {
    const last = new Date(now - 60 * 60 * 1000).toISOString();
    expect(isPrefDue({ cadence: "daily" }, last, now)).toBe(false);
  });

  it("daily is due just over a day later", () => {
    const last = new Date(now - 25 * 60 * 60 * 1000).toISOString();
    expect(isPrefDue({ cadence: "daily" }, last, now)).toBe(true);
  });

  it("weekly waits a full week", () => {
    const threeDays = new Date(now - 3 * 24 * 60 * 60 * 1000).toISOString();
    const eightDays = new Date(now - 8 * 24 * 60 * 60 * 1000).toISOString();
    expect(isPrefDue({ cadence: "weekly" }, threeDays, now)).toBe(false);
    expect(isPrefDue({ cadence: "weekly" }, eightDays, now)).toBe(true);
  });
});

describe("slack adapter (mock-or-real discipline)", () => {
  it("is unconfigured in the test env (no SLACK_BOT_TOKEN)", () => {
    expect(slackAdapter.isConfigured()).toBe(false);
  });

  it("returns a well-formed mock result when unconfigured — ok, not live, no throw", async () => {
    const res = await slackAdapter.dispatch({
      orgId: "org-1",
      actorId: "system",
      action: "distribute_report",
      channel: "slack",
      target: { name: "#sourcing" },
      body: "*Daily Act-now Radar*",
    });
    expect(res.ok).toBe(true);
    expect(res.live).toBe(false);
    expect(res.channel).toBe("slack");
    expect(res.detail).toContain("#sourcing");
  });
});
