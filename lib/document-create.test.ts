import {
  AI_DRAFTABLE_SECTIONS,
  groupTemplates,
  keyMaterialStatus,
  missingMaterialCount,
  sectionLabelOf,
} from "./document-create";
import { DOCUMENT_TEMPLATE_LIBRARY } from "./document-template-library";
import { DATA_ROOM_SECTIONS, KEY_MATERIALS } from "./data-room";

describe("sectionLabelOf", () => {
  it("resolves a real section to its label", () => {
    expect(sectionLabelOf("fund_terms")).toBe("Fund Terms");
  });

  it("falls back to the key rather than rendering blank", () => {
    expect(sectionLabelOf("not_a_section")).toBe("not_a_section");
  });
});

describe("groupTemplates", () => {
  it("keeps every template exactly once", () => {
    const groups = groupTemplates();
    const ids = groups.flatMap((g) => g.templates.map((t) => t.id));
    expect(ids).toHaveLength(DOCUMENT_TEMPLATE_LIBRARY.length);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("groups by section and labels each group", () => {
    const groups = groupTemplates();
    const marketing = groups.find((g) => g.section === "marketing");
    expect(marketing?.sectionLabel).toBe("Marketing & Materials");
    // marketing carries the most templates in the shipped library
    expect(marketing?.templates.length).toBeGreaterThan(1);
    expect(marketing?.templates.every((t) => t.section === "marketing")).toBe(true);
  });

  it("orders groups the way the data room does, not alphabetically", () => {
    const groups = groupTemplates();
    const order = groups.map((g) => g.section);
    const expected = DATA_ROOM_SECTIONS.map((s) => s.key).filter((k) => order.includes(k));
    expect(order).toEqual(expected);
    // "overview" precedes "marketing" in the data room but not in the alphabet.
    expect(order.indexOf("overview")).toBeLessThan(order.indexOf("marketing"));
  });

  it("orders templates alphabetically within a group", () => {
    const groups = groupTemplates([
      { id: "z", label: "Zulu", description: "", section: "legal", content: "" },
      { id: "a", label: "Alpha", description: "", section: "legal", content: "" },
    ]);
    expect(groups[0].templates.map((t) => t.label)).toEqual(["Alpha", "Zulu"]);
  });

  it("carries each template's description through for the gallery", () => {
    const groups = groupTemplates();
    const ddq = groups.flatMap((g) => g.templates).find((t) => t.id === "ddq");
    expect(ddq?.description).toBeTruthy();
    expect(ddq?.sectionLabel).toBe("Diligence / DDQ");
  });

  it("returns nothing for an empty library rather than an empty group", () => {
    expect(groupTemplates([])).toEqual([]);
  });
});

describe("keyMaterialStatus", () => {
  it("covers every key material", () => {
    expect(keyMaterialStatus([])).toHaveLength(KEY_MATERIALS.length);
  });

  it("marks everything missing for an empty library", () => {
    const statuses = keyMaterialStatus([]);
    expect(statuses.every((s) => !s.present)).toBe(true);
    expect(missingMaterialCount(statuses)).toBe(KEY_MATERIALS.length);
  });

  it("detects a material by an alias, not just its exact name", () => {
    const statuses = keyMaterialStatus(["Fund IV Pitch Deck"]);
    expect(statuses.find((s) => s.name === "Investor Deck")?.present).toBe(true);
  });

  it("matches case-insensitively and within a longer name", () => {
    const statuses = keyMaterialStatus(["2026 EXEC SUMMARY (final)"]);
    expect(statuses.find((s) => s.name === "Executive Summary")?.present).toBe(true);
  });

  it("does not care which section the document was filed under", () => {
    // An operator who filed their deck under Firm Overview still has a deck; a
    // false "missing" on something they can see would make this untrustworthy.
    const statuses = keyMaterialStatus(["Investor Deck"]);
    expect(statuses.find((s) => s.name === "Investor Deck")?.present).toBe(true);
  });

  it("does not match an unrelated document", () => {
    const statuses = keyMaterialStatus(["Form ADV Part 2A", "Audited Financials 2025"]);
    expect(statuses.every((s) => !s.present)).toBe(true);
  });

  it("offers a template where one exists and null where none does", () => {
    const statuses = keyMaterialStatus([]);
    expect(statuses.find((s) => s.name === "Executive Summary")?.templateId).toBe("exec_summary");
    expect(statuses.find((s) => s.name === "Investor Deck")?.templateId).toBe("pitch_deck_outline");
    // Teaser has no template; it still offers a blank document.
    expect(statuses.find((s) => s.name === "Teaser")?.templateId).toBeNull();
  });

  it("points every named template at one that actually exists", () => {
    const ids = new Set(DOCUMENT_TEMPLATE_LIBRARY.map((t) => t.id));
    for (const s of keyMaterialStatus([])) {
      if (s.templateId) expect(ids.has(s.templateId)).toBe(true);
    }
  });

  it("reports whether Earn can draft the material's section", () => {
    const statuses = keyMaterialStatus([]);
    // Every shipped key material is filed under marketing, which is draftable.
    expect(statuses.every((s) => s.aiDraftable === AI_DRAFTABLE_SECTIONS.has(s.section))).toBe(true);
  });

  it("labels each material's section for display", () => {
    const statuses = keyMaterialStatus([]);
    expect(statuses.every((s) => s.sectionLabel && s.sectionLabel !== s.section)).toBe(true);
  });
});

describe("missingMaterialCount", () => {
  it("counts only what is absent", () => {
    const statuses = keyMaterialStatus(["Executive Summary", "Teaser"]);
    expect(missingMaterialCount(statuses)).toBe(KEY_MATERIALS.length - 2);
  });

  it("is zero once everything is present", () => {
    const names = KEY_MATERIALS.map((m) => m.name);
    expect(missingMaterialCount(keyMaterialStatus(names))).toBe(0);
  });
});

describe("AI_DRAFTABLE_SECTIONS", () => {
  it("names only real data-room sections", () => {
    const keys = new Set(DATA_ROOM_SECTIONS.map((s) => s.key));
    for (const s of AI_DRAFTABLE_SECTIONS) expect(keys.has(s)).toBe(true);
  });
});
