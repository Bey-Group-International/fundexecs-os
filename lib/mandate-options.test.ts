import {
  MANDATE_ACTION_OPTIONS,
  isMandateActionKind,
  sanitizeMandateActions,
} from "@/lib/mandate-options";
import { tierForAction } from "@/lib/gates";

describe("mandate-options catalog", () => {
  it("only contains Tier-2 action kinds", () => {
    for (const option of MANDATE_ACTION_OPTIONS) {
      expect(tierForAction(option.kind)).toBe(2);
    }
  });

  it("exposes a label and a one-line description for every option", () => {
    for (const option of MANDATE_ACTION_OPTIONS) {
      expect(option.label.trim().length).toBeGreaterThan(0);
      expect(option.description.trim().length).toBeGreaterThan(0);
    }
  });

  it("has no duplicate kinds", () => {
    const kinds = MANDATE_ACTION_OPTIONS.map((o) => o.kind);
    expect(new Set(kinds).size).toBe(kinds.length);
  });

  it("includes the canonical Tier-2 actions", () => {
    const kinds = MANDATE_ACTION_OPTIONS.map((o) => o.kind);
    expect(kinds).toEqual(
      expect.arrayContaining([
        "send_outreach",
        "send_intro_request",
        "share_materials",
        "send_diligence_request",
        "distribute_report",
      ]),
    );
  });
});

describe("isMandateActionKind", () => {
  it("accepts a Tier-2 kind", () => {
    expect(isMandateActionKind("send_outreach")).toBe(true);
  });

  it("rejects a Tier-1 kind", () => {
    expect(isMandateActionKind("draft_memo")).toBe(false);
  });

  it("rejects a Tier-3 kind", () => {
    expect(isMandateActionKind("move_capital")).toBe(false);
  });

  it("rejects an unknown string", () => {
    expect(isMandateActionKind("not_a_real_action")).toBe(false);
  });
});

describe("sanitizeMandateActions", () => {
  it("keeps only Tier-2 kinds", () => {
    expect(sanitizeMandateActions(["send_outreach", "share_materials"])).toEqual([
      "send_outreach",
      "share_materials",
    ]);
  });

  it("drops a Tier-3 kind like move_capital", () => {
    expect(sanitizeMandateActions(["send_outreach", "move_capital"])).toEqual([
      "send_outreach",
    ]);
  });

  it("drops Tier-1 kinds", () => {
    expect(sanitizeMandateActions(["draft_message", "send_intro_request"])).toEqual([
      "send_intro_request",
    ]);
  });

  it("drops unknown strings", () => {
    expect(sanitizeMandateActions(["bogus", "send_outreach"])).toEqual(["send_outreach"]);
  });

  it("de-duplicates while preserving first-seen order", () => {
    expect(
      sanitizeMandateActions(["share_materials", "send_outreach", "share_materials"]),
    ).toEqual(["share_materials", "send_outreach"]);
  });

  it("returns an empty array for an empty or all-invalid input", () => {
    expect(sanitizeMandateActions([])).toEqual([]);
    expect(sanitizeMandateActions(["move_capital", "draft_memo", "xyz"])).toEqual([]);
  });
});
