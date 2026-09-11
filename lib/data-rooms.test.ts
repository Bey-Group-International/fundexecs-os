// lib/data-rooms.test.ts
// The split's load-bearing rule: a room shows what is *published into it*, not
// what the firm holds. These tests pin that down, plus the room-side view
// models the sharing surface renders from.
import {
  groupRoomDocuments,
  summarizeRoom,
  unfinishedPublications,
  emptyPublications,
  shareState,
  shareExposure,
  shareDocCount,
  sectionsAllowedBy,
  sectionLabel,
  type RoomDocument,
} from "@/lib/data-rooms";

function doc(over: Partial<RoomDocument> & { id: string }): RoomDocument {
  return {
    name: `Doc ${over.id}`,
    section: "other",
    status: "ready",
    sortOrder: 0,
    storageKey: null,
    hasContent: true,
    ...over,
  };
}

describe("groupRoomDocuments", () => {
  it("orders sections canonically, not by insertion", () => {
    // financials sits after thesis in DATA_ROOM_SECTIONS; input order is reversed.
    const sections = groupRoomDocuments([
      doc({ id: "a", section: "financials" }),
      doc({ id: "b", section: "thesis" }),
    ]);
    expect(sections.map((s) => s.key)).toEqual(["thesis", "financials"]);
  });

  it("orders documents inside a section by the room's own sort order", () => {
    const sections = groupRoomDocuments([
      doc({ id: "a", section: "legal", sortOrder: 2 }),
      doc({ id: "b", section: "legal", sortOrder: 0 }),
      doc({ id: "c", section: "legal", sortOrder: 1 }),
    ]);
    expect(sections[0].docs.map((d) => d.id)).toEqual(["b", "c", "a"]);
  });

  it("drops empty sections — a room shows what it holds, not what it lacks", () => {
    const sections = groupRoomDocuments([doc({ id: "a", section: "team" })]);
    expect(sections).toHaveLength(1);
    expect(sections[0].key).toBe("team");
  });

  it("files an unrecognized section under the catch-all rather than dropping it", () => {
    const sections = groupRoomDocuments([doc({ id: "a", section: "not_a_section" })]);
    expect(sections.map((s) => s.key)).toEqual(["other"]);
  });
});

describe("summarizeRoom", () => {
  it("counts only documents published into this room", () => {
    // One published financials doc. The firm may hold twenty more in its
    // library; none of them may make this room look covered.
    const s = summarizeRoom({}, [doc({ id: "a", section: "financials" })]);
    const fin = s.items.find((i) => i.key === "financials")!;
    const legal = s.items.find((i) => i.key === "legal")!;
    expect(fin.ready).toBe(true);
    expect(fin.docCount).toBe(1);
    expect(legal.ready).toBe(false);
  });

  it("still credits sections backed by the firm's Build foundation", () => {
    // The branded sheet carries thesis/track-record/team data, so those
    // sections read as covered even with nothing published.
    const s = summarizeRoom({ thesis: "complete" }, []);
    expect(s.items.find((i) => i.key === "thesis")!.ready).toBe(true);
    expect(s.items.find((i) => i.key === "thesis")!.viaBuild).toBe(true);
  });

  it("reports an empty room as zero coverage", () => {
    const s = summarizeRoom({}, []);
    expect(s.readyCount).toBe(0);
    expect(s.weightedPercent).toBe(0);
    expect(s.suggestions.length).toBe(s.total);
  });
});

describe("publication warnings", () => {
  it("flags published documents still marked draft or in review", () => {
    const flagged = unfinishedPublications([
      doc({ id: "a", status: "ready" }),
      doc({ id: "b", status: "draft" }),
      doc({ id: "c", status: "review" }),
    ]);
    expect(flagged.map((d) => d.id)).toEqual(["b", "c"]);
  });

  it("flags published documents with neither a link nor content", () => {
    const flagged = emptyPublications([
      doc({ id: "a", hasContent: true }),
      doc({ id: "b", hasContent: false, storageKey: "https://example.com/x.pdf" }),
      doc({ id: "c", hasContent: false }),
    ]);
    expect(flagged.map((d) => d.id)).toEqual(["c"]);
  });
});

describe("shareState", () => {
  const base = { label: null, expires_at: null, revoked_at: null, allowed_sections: null };
  const now = Date.parse("2026-06-01T00:00:00Z");

  it("is active with no expiry and no revocation", () => {
    expect(shareState(base, now)).toBe("active");
  });

  it("reports revoked ahead of expiry", () => {
    expect(
      shareState({ ...base, revoked_at: "2026-05-01T00:00:00Z", expires_at: "2026-05-02T00:00:00Z" }, now),
    ).toBe("revoked");
  });

  it("reports expired once the expiry has passed", () => {
    expect(shareState({ ...base, expires_at: "2026-05-31T23:59:00Z" }, now)).toBe("expired");
    expect(shareState({ ...base, expires_at: "2026-06-02T00:00:00Z" }, now)).toBe("active");
  });
});

describe("shareExposure", () => {
  const sections = groupRoomDocuments([
    doc({ id: "a", section: "thesis" }),
    doc({ id: "b", section: "financials" }),
    doc({ id: "c", section: "financials" }),
  ]);
  const base = { label: null, expires_at: null, revoked_at: null };

  it("exposes every published section when no allowlist is set", () => {
    const exposed = shareExposure({ ...base, allowed_sections: null }, sections);
    expect(exposed.map((s) => s.key)).toEqual(["thesis", "financials"]);
    expect(shareDocCount({ ...base, allowed_sections: null }, sections)).toBe(3);
  });

  it("narrows to the allowlist", () => {
    const share = { ...base, allowed_sections: ["financials"] };
    expect(shareExposure(share, sections).map((s) => s.key)).toEqual(["financials"]);
    expect(shareDocCount(share, sections)).toBe(2);
  });

  it("can never widen beyond what the room publishes", () => {
    // 'legal' is in the allowlist but nothing legal is published here.
    const share = { ...base, allowed_sections: ["legal", "thesis"] };
    expect(shareExposure(share, sections).map((s) => s.key)).toEqual(["thesis"]);
    expect(shareDocCount(share, sections)).toBe(1);
  });

  it("treats an empty allowlist as allowing nothing, not everything", () => {
    // An allowlist is deny-by-default: a corrupt [] must fail closed rather
    // than disclose the whole room.
    expect(shareExposure({ ...base, allowed_sections: [] }, sections)).toHaveLength(0);
    expect(shareDocCount({ ...base, allowed_sections: [] }, sections)).toBe(0);
  });
});

describe("sectionLabel", () => {
  it("resolves a known key", () => {
    expect(sectionLabel("fund_terms")).toBe("Fund Terms");
  });

  it("falls back to the catch-all for null or unknown keys", () => {
    expect(sectionLabel(null)).toBe("Other Materials");
    expect(sectionLabel("nope")).toBe("Other Materials");
  });
});

describe("sectionsAllowedBy", () => {
  const sections = [{ key: "thesis" }, { key: "financials" }, { key: "legal" }];

  it("passes everything through only when there is no allowlist at all", () => {
    expect(sectionsAllowedBy(null, sections)).toHaveLength(3);
    expect(sectionsAllowedBy(undefined, sections)).toHaveLength(3);
  });

  it("fails closed on an empty allowlist", () => {
    // Matches app/dataroom/[token]/d/[id] , which has always denied on [].
    expect(sectionsAllowedBy([], sections)).toHaveLength(0);
  });

  it("keeps only allowed keys, in the original order", () => {
    expect(sectionsAllowedBy(["legal", "thesis"], sections).map((s) => s.key)).toEqual([
      "thesis",
      "legal",
    ]);
  });

  it("ignores allowlist entries with no matching section", () => {
    expect(sectionsAllowedBy(["nope"], sections)).toEqual([]);
  });

  it("works on any shape carrying a key — GP rows and viewer sections alike", () => {
    const viewerish = [{ key: "thesis", label: "Thesis", docs: [{ id: "d1" }] }];
    expect(sectionsAllowedBy(["thesis"], viewerish)[0].docs).toHaveLength(1);
  });
});
