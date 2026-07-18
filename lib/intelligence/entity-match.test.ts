// Tests for entity resolution — match precedence + confidence discipline.
import { matchHint, matchEntities, normalizeName, bestMatchStrength } from "./entity-match";
import type { TrackedEntity } from "./types";

function entity(over: Partial<TrackedEntity> = {}): TrackedEntity {
  return {
    id: "e1",
    workspaceId: "org1",
    entityType: "company",
    name: "Acme Corp",
    aliases: ["Acme"],
    description: null,
    externalIdentifiers: { cik: "0001" },
    status: "active",
    createdBy: null,
    createdAt: "",
    updatedAt: "",
    ...over,
  };
}

describe("normalizeName", () => {
  it("strips punctuation, suffixes, and case", () => {
    expect(normalizeName("Acme Corp.")).toBe("acme");
    expect(normalizeName("Blackstone Capital Partners LP")).toBe("blackstone");
  });
});

describe("matchHint", () => {
  const universe = [entity()];

  it("matches on external identifier with top confidence", () => {
    const m = matchHint({ name: "Totally Different", externalIdentifiers: { cik: "0001" } }, universe);
    expect(m?.method).toBe("external_id");
    expect(m?.confidence).toBe(1);
  });

  it("matches exact normalized name", () => {
    const m = matchHint({ name: "ACME corp" }, universe);
    expect(m?.method).toBe("exact");
    expect(m?.entity.id).toBe("e1");
  });

  it("matches an alias when the name differs", () => {
    const m = matchHint({ name: "Acme" }, [entity({ name: "Wile E Ventures", aliases: ["Acme"], externalIdentifiers: {} })]);
    expect(m?.method).toBe("alias");
  });

  it("carries the provider relationship through", () => {
    const m = matchHint({ name: "Acme Corp", providerRelationship: "acquirer" }, universe);
    expect(m?.providerRelationship).toBe("acquirer");
  });

  it("returns null below the inferred threshold", () => {
    const m = matchHint({ name: "Zenith Robotics" }, universe);
    expect(m).toBeNull();
  });

  it("inferred matches are always tentative (capped)", () => {
    const m = matchHint({ name: "Northwind Energy Systems" }, [entity({ name: "Northwind Energy Grid", aliases: [], externalIdentifiers: {} })]);
    expect(m?.method).toBe("inferred");
    expect(m!.confidence).toBeLessThanOrEqual(0.75);
  });
});

describe("matchEntities", () => {
  it("de-dupes to the strongest match per entity", () => {
    const e = entity();
    const matches = matchEntities([{ name: "Acme" }, { name: "Acme Corp" }], [e]);
    expect(matches).toHaveLength(1);
    expect(matches[0].entity.id).toBe("e1");
    // The exact match (0.95) beats the alias match (0.85).
    expect(matches[0].confidence).toBe(0.95);
  });

  it("bestMatchStrength returns 0 when nothing matched", () => {
    expect(bestMatchStrength([])).toBe(0);
  });
});
