import {
  ALWAYS_PROHIBITED_ACTIONS,
  applyDecision,
  blockingLowConfidence,
  browserActionTier,
  buildReviewRecord,
  buildScopeCard,
  canSubmitForSave,
  canTransition,
  describeAuditEvent,
  evaluateBrowserConsent,
  legalNextStatuses,
  needsExternalActionApproval,
  nextOnEvent,
  policyForSource,
  scopeRequiresUserAuth,
  type ExtractedDataPoint,
} from "./index";

describe("session-machine — legal transitions", () => {
  it("walks the full happy path through the review gate to saved", () => {
    const path: Array<[Parameters<typeof canTransition>[0], Parameters<typeof canTransition>[1]]> = [
      ["planned", "awaiting_user_approval"],
      ["awaiting_user_approval", "opening_browser"],
      ["opening_browser", "navigating"],
      ["navigating", "paused_for_user_auth"],
      ["paused_for_user_auth", "user_auth_completed"],
      ["user_auth_completed", "extracting"],
      ["extracting", "normalizing"],
      ["normalizing", "awaiting_user_review"],
      ["awaiting_user_review", "approved_for_save"],
      ["approved_for_save", "saved"],
    ];
    for (const [from, to] of path) {
      expect(canTransition(from, to)).toBe(true);
    }
  });

  it("allows navigating straight to extracting when no auth is needed", () => {
    expect(canTransition("navigating", "extracting")).toBe(true);
  });

  it("lets any non-terminal state be cancelled or failed", () => {
    for (const s of [
      "planned",
      "opening_browser",
      "navigating",
      "paused_for_user_auth",
      "extracting",
      "awaiting_user_review",
    ] as const) {
      expect(canTransition(s, "cancelled")).toBe(true);
      expect(canTransition(s, "failed")).toBe(true);
    }
  });
});

describe("session-machine — illegal transitions", () => {
  it("cannot reach saved without passing through review", () => {
    expect(canTransition("extracting", "saved")).toBe(false);
    expect(canTransition("normalizing", "saved")).toBe(false);
    expect(canTransition("awaiting_user_review", "saved")).toBe(false);
  });

  it("cannot skip the approval step", () => {
    expect(canTransition("planned", "opening_browser")).toBe(false);
    expect(canTransition("awaiting_user_approval", "extracting")).toBe(false);
  });

  it("never transitions out of a terminal state — not even to cancelled", () => {
    for (const t of ["saved", "rejected", "cancelled", "failed"] as const) {
      expect(canTransition(t, "cancelled")).toBe(false);
      expect(canTransition(t, "failed")).toBe(false);
      expect(canTransition(t, "planned")).toBe(false);
    }
  });

  it("rejects self-transitions", () => {
    expect(canTransition("navigating", "navigating")).toBe(false);
  });
});

describe("session-machine — nextOnEvent", () => {
  it("resolves events to the correct next status", () => {
    expect(nextOnEvent("planned", "submit_scope")).toBe("awaiting_user_approval");
    expect(nextOnEvent("awaiting_user_approval", "approve_scope")).toBe("opening_browser");
    expect(nextOnEvent("paused_for_user_auth", "resume_after_auth")).toBe("user_auth_completed");
    expect(nextOnEvent("awaiting_user_review", "approve_save")).toBe("approved_for_save");
    expect(nextOnEvent("approved_for_save", "save_complete")).toBe("saved");
  });

  it("only resumes an auth handoff from paused_for_user_auth on the resume event", () => {
    expect(nextOnEvent("navigating", "resume_after_auth")).toBeNull();
    expect(nextOnEvent("extracting", "resume_after_auth")).toBeNull();
    // And a paused session cannot self-advance to extraction without resuming.
    expect(nextOnEvent("paused_for_user_auth", "begin_extraction")).toBeNull();
  });

  it("returns null for an event illegal from the current status", () => {
    expect(nextOnEvent("planned", "save_complete")).toBeNull();
    expect(nextOnEvent("extracting", "approve_save")).toBeNull();
  });

  it("always permits cancel/fail from a live state", () => {
    expect(nextOnEvent("extracting", "cancel")).toBe("cancelled");
    expect(nextOnEvent("navigating", "fail")).toBe("failed");
    expect(nextOnEvent("saved", "cancel")).toBeNull();
  });

  it("legalNextStatuses includes cancel/fail and forward edges, empty for terminal", () => {
    expect(legalNextStatuses("navigating").sort()).toEqual(
      ["cancelled", "extracting", "failed", "paused_for_user_auth"].sort(),
    );
    expect(legalNextStatuses("saved")).toEqual([]);
  });
});

describe("task-plan — scope card derivation", () => {
  it("derives sources from prompt keywords", () => {
    const scope = buildScopeCard("Research this LP on LinkedIn and pull their EDGAR filing");
    expect(scope.permitted_sources).toEqual(expect.arrayContaining(["linkedin", "edgar"]));
  });

  it("falls back to public_web only when nothing is recognized", () => {
    const scope = buildScopeCard("figure out what this fund is about");
    expect(scope.permitted_sources).toEqual(["public_web"]);
  });

  it("always requires review and always attaches the prohibited actions", () => {
    const scope = buildScopeCard("check their gmail");
    expect(scope.requires_user_review).toBe(true);
    expect(scope.requires_user_save_approval).toBe(true);
    expect(scope.requires_external_action_approval).toBe(true);
    for (const action of ALWAYS_PROHIBITED_ACTIONS) {
      expect(scope.prohibited_actions).toContain(action);
    }
    // Prohibited actions are never in the permitted set.
    for (const action of scope.prohibited_actions) {
      expect(scope.permitted_actions).not.toContain(action);
    }
  });

  it("adds an auth handoff for login-gated sources", () => {
    const linkedin = buildScopeCard("scan LinkedIn");
    expect(scopeRequiresUserAuth(linkedin)).toBe(true);
    const edgar = buildScopeCard("pull the EDGAR 13F");
    expect(scopeRequiresUserAuth(edgar)).toBe(false);
  });
});

describe("consent-gates — tier classification", () => {
  it("classifies internal research/extraction as Tier 1", () => {
    expect(browserActionTier("navigate")).toBe(1);
    expect(browserActionTier("read_page")).toBe(1);
    expect(browserActionTier("extract_data")).toBe(1);
    expect(browserActionTier("build_prospect_list")).toBe(1);
  });

  it("classifies external outreach as Tier 2", () => {
    expect(browserActionTier("prepare_outreach")).toBe(2);
    expect(browserActionTier("send_message")).toBe(2);
    expect(browserActionTier("request_intro")).toBe(2);
  });

  it("classifies capital-binding / data-room access as Tier 3", () => {
    expect(browserActionTier("grant_data_room_access")).toBe(3);
    expect(browserActionTier("make_purchase")).toBe(3);
    expect(browserActionTier("bind_capital")).toBe(3);
    expect(browserActionTier("sign_document")).toBe(3);
  });

  it("flags external actions as needing separate approval, but not reads/drafts", () => {
    expect(needsExternalActionApproval("send_message")).toBe(true);
    expect(needsExternalActionApproval("grant_data_room_access")).toBe(true);
    expect(needsExternalActionApproval("extract_data")).toBe(false);
    expect(needsExternalActionApproval("draft_outreach")).toBe(false);
  });

  it("evaluateBrowserConsent rolls tier + approval together", () => {
    const d = evaluateBrowserConsent("send_message");
    expect(d.tier).toBe(2);
    expect(d.requiresOperatorSignoff).toBe(true);
    expect(d.requiresExternalActionApproval).toBe(true);
    const r = evaluateBrowserConsent("extract_data");
    expect(r.requiresOperatorSignoff).toBe(false);
  });
});

describe("source-policy", () => {
  it("LinkedIn: auth-gated, private, no sending or scraping at scale", () => {
    const p = policyForSource("linkedin");
    expect(p.requires_user_auth).toBe(true);
    expect(p.public_source).toBe(false);
    expect(p.default_private).toBe(true);
    expect(p.prohibited_actions).toContain("send_message");
    expect(p.policy_note.toLowerCase()).toContain("scale");
  });

  it("Gmail: no send/delete, records private", () => {
    const p = policyForSource("gmail");
    expect(p.requires_user_auth).toBe(true);
    expect(p.default_private).toBe(true);
    expect(p.prohibited_actions).toEqual(
      expect.arrayContaining(["send_message", "delete_data"]),
    );
    expect(p.allowed_actions).not.toContain("send_message");
  });

  it("EDGAR: high-confidence public source, no login", () => {
    const p = policyForSource("edgar");
    expect(p.public_source).toBe(true);
    expect(p.requires_user_auth).toBe(false);
    expect(p.base_confidence).toBeGreaterThanOrEqual(90);
  });
});

describe("review-queue — low confidence blocking", () => {
  const points: ExtractedDataPoint[] = [
    {
      field_name: "full_name",
      extracted_value: "Jane Doe",
      source_type: "linkedin",
      captured_at: "2026-07-05T00:00:00Z",
      confidence_score: 92,
      requires_user_confirmation: false,
    },
    {
      field_name: "email",
      extracted_value: "jane@maybe.com",
      source_type: "public_web",
      captured_at: "2026-07-05T00:00:00Z",
      confidence_score: 40,
      requires_user_confirmation: false,
    },
    {
      field_name: "title",
      extracted_value: "Partner",
      source_type: "linkedin",
      captured_at: "2026-07-05T00:00:00Z",
      confidence_score: 88,
      requires_user_confirmation: true,
    },
  ];

  it("blockingLowConfidence flags low-score and explicitly-flagged fields", () => {
    const blocked = blockingLowConfidence(points).map((p) => p.field_name).sort();
    expect(blocked).toEqual(["email", "title"]);
  });

  it("builds a review record and blocks save until low-confidence fields are decided", () => {
    let record = buildReviewRecord(points);
    expect(record.summary.total).toBe(3);
    expect(record.summary.low_confidence).toBe(2);
    expect(record.summary.needs_confirmation).toBe(true);
    expect(canSubmitForSave(record)).toBe(false);

    // Approve the safe field only — still blocked by undecided low-confidence.
    record = applyDecision(record, "full_name", "approved");
    expect(canSubmitForSave(record)).toBe(false);

    // Decide the two blocking fields — now save can proceed.
    record = applyDecision(record, "email", "rejected");
    record = applyDecision(record, "title", "approved");
    expect(record.summary.needs_confirmation).toBe(false);
    expect(canSubmitForSave(record)).toBe(true);
  });

  it("applyDecision does not mutate the input record", () => {
    const record = buildReviewRecord(points);
    const next = applyDecision(record, "full_name", "approved");
    expect(record.fields.find((f) => f.field_name === "full_name")?.decision).toBe("pending");
    expect(next.fields.find((f) => f.field_name === "full_name")?.decision).toBe("approved");
  });
});

describe("audit-log", () => {
  it("describes events, preferring a custom summary and appending source", () => {
    expect(describeAuditEvent({ action: "scope_created" })).toMatch(/proposed a scope/i);
    expect(
      describeAuditEvent({ action: "extraction_started", source_type: "edgar" }),
    ).toContain("(edgar)");
    expect(
      describeAuditEvent({ action: "navigated", summary: "Opened Cedar Ridge filing" }),
    ).toBe("Opened Cedar Ridge filing");
  });
});
