import {
  addDays,
  automationDedupeKey,
  conditionHolds,
  conditionsHold,
  describeAutomation,
  isConditionField,
  mapAutomation,
  planActions,
  renderTemplate,
  templateValues,
  triggerMatches,
  validateAutomationBody,
  type Action,
  type Condition,
  type Snapshot,
} from "@/lib/network-automations";

const DEAL: Snapshot = {
  id: "op-1",
  name: "Meridian Partners — Fund III",
  stage: "diligence",
  status: "open",
  owner_id: "user-a",
  contact_id: "c-1",
  investor_id: null,
  target_amount: 5_000_000,
  currency: "USD",
  probability: 40,
  expected_close: "2026-12-31",
  tags: ["institutional"],
  custom: { consultant: "Cambridge", ic_date: "2026-11-01" },
  updated_at: "2026-09-21T10:00:00.000Z",
};

const CONTACT_STAGES = [
  "prospect",
  "engaged",
  "diligence",
  "committed",
  "dormant",
  "passed",
] as const;

const OPPORTUNITY_STAGES = [
  "sourced",
  "qualified",
  "diligence",
  "ic_review",
  "legal",
  "committed",
  "passed",
] as const;

describe("conditions", () => {
  it("compares numbers numerically, not as strings", () => {
    // The string comparison "5000000" < "900000" is true, which would make a
    // 5m deal match "under 900k". Numbers have to win.
    expect(conditionHolds({ field: "target_amount", op: "lt", value: 900_000 }, DEAL)).toBe(false);
    expect(conditionHolds({ field: "target_amount", op: "gt", value: 900_000 }, DEAL)).toBe(true);
  });

  it("accepts a numeric value that arrived from a form as a string", () => {
    expect(conditionHolds({ field: "probability", op: "gte", value: "40" }, DEAL)).toBe(true);
    expect(conditionHolds({ field: "probability", op: "eq", value: "40" }, DEAL)).toBe(true);
  });

  it("does not let a missing value satisfy a threshold", () => {
    // A deal with no target_amount is not "under five million" — it is
    // unknown, and raising a follow-up about a number nobody entered is the
    // kind of thing that makes a firm switch automations off.
    const noAmount = { ...DEAL, target_amount: null };
    expect(conditionHolds({ field: "target_amount", op: "lt", value: 5_000_000 }, noAmount)).toBe(
      false,
    );
    expect(conditionHolds({ field: "target_amount", op: "gte", value: 0 }, noAmount)).toBe(false);
  });

  it("does not let a BLANK text value satisfy a text threshold", () => {
    // This is the case the emptiness guard actually exists for, and the one a
    // numeric example does not reach: an unset select column is the empty
    // string, and "" sorts before every non-empty string, so a rule reading
    // `custom.tier < "C"` would fire on every row where nobody filled the
    // column in. The numeric cases above are already refused by the comparison
    // itself; this one is not.
    const blank = { ...DEAL, custom: { tier: "" } };
    expect(conditionHolds({ field: "custom.tier", op: "lt", value: "C" }, blank)).toBe(false);
    expect(conditionHolds({ field: "custom.tier", op: "lte", value: "C" }, blank)).toBe(false);
    // A row that DOES have a value still compares normally — without this the
    // test above would pass against a `contains`-style rewrite that refuses
    // everything.
    expect(
      conditionHolds({ field: "custom.tier", op: "lt", value: "C" }, { ...DEAL, custom: { tier: "B" } }),
    ).toBe(true);
  });

  it("reads custom columns through custom.<key>", () => {
    expect(conditionHolds({ field: "custom.consultant", op: "eq", value: "Cambridge" }, DEAL)).toBe(
      true,
    );
    expect(conditionHolds({ field: "custom.consultant", op: "eq", value: "Mercer" }, DEAL)).toBe(
      false,
    );
    expect(conditionHolds({ field: "custom.absent", op: "is_empty" }, DEAL)).toBe(true);
  });

  it("treats contains as membership on arrays and substring on text", () => {
    expect(conditionHolds({ field: "tags", op: "contains", value: "institutional" }, DEAL)).toBe(
      true,
    );
    expect(conditionHolds({ field: "tags", op: "contains", value: "family_office" }, DEAL)).toBe(
      false,
    );
    expect(conditionHolds({ field: "name", op: "contains", value: "meridian" }, DEAL)).toBe(true);
  });

  it("supports a list of stages via in", () => {
    expect(
      conditionHolds({ field: "stage", op: "in", value: ["diligence", "ic_review"] }, DEAL),
    ).toBe(true);
    expect(conditionHolds({ field: "stage", op: "in", value: ["sourced"] }, DEAL)).toBe(false);
    // A non-array value is a misconfigured rule, and must not match everything.
    expect(conditionHolds({ field: "stage", op: "in", value: "diligence" }, DEAL)).toBe(false);
  });

  it("requires every condition to hold, and an empty list holds", () => {
    const both: Condition[] = [
      { field: "stage", op: "eq", value: "diligence" },
      { field: "probability", op: "gte", value: 30 },
    ];
    expect(conditionsHold(both, DEAL)).toBe(true);
    expect(conditionsHold([...both, { field: "currency", op: "eq", value: "EUR" }], DEAL)).toBe(
      false,
    );
    expect(conditionsHold([], DEAL)).toBe(true);
  });

  it("only allows fields a rule is permitted to read", () => {
    expect(isConditionField("stage")).toBe(true);
    expect(isConditionField("custom.ic_date")).toBe(true);
    expect(isConditionField("notes")).toBe(false);
    expect(isConditionField("custom.NotASlug")).toBe(false);
    expect(isConditionField("__proto__")).toBe(false);
  });
});

describe("trigger matching", () => {
  const stageEvent = {
    kind: "opportunity_stage_changed" as const,
    from: "qualified",
    to: "diligence",
    snapshot: DEAL,
  };

  it("narrows a stage rule by from and by to", () => {
    expect(triggerMatches({ triggerType: "opportunity_stage_changed", triggerConfig: {} }, stageEvent)).toBe(true);
    expect(
      triggerMatches(
        { triggerType: "opportunity_stage_changed", triggerConfig: { toStage: "diligence" } },
        stageEvent,
      ),
    ).toBe(true);
    expect(
      triggerMatches(
        { triggerType: "opportunity_stage_changed", triggerConfig: { toStage: "legal" } },
        stageEvent,
      ),
    ).toBe(false);
    expect(
      triggerMatches(
        { triggerType: "opportunity_stage_changed", triggerConfig: { fromStage: "sourced" } },
        stageEvent,
      ),
    ).toBe(false);
  });

  it("treats won and lost as the two terminal stages", () => {
    const won = { ...stageEvent, to: "committed" };
    const lost = { ...stageEvent, to: "passed" };
    expect(triggerMatches({ triggerType: "opportunity_won", triggerConfig: {} }, won)).toBe(true);
    expect(triggerMatches({ triggerType: "opportunity_won", triggerConfig: {} }, lost)).toBe(false);
    expect(triggerMatches({ triggerType: "opportunity_lost", triggerConfig: {} }, lost)).toBe(true);
  });

  it("never fires a scheduled rule from an event", () => {
    // The sweep selects these rules' rows itself. If an event could match one,
    // an idle-deal rule would fire on every edit — the opposite of what it
    // means.
    for (const triggerType of ["opportunity_idle", "contact_going_cold", "close_date_approaching"] as const) {
      expect(triggerMatches({ triggerType, triggerConfig: { days: 30 } }, stageEvent)).toBe(false);
    }
  });

  it("does not cross the two stage-change triggers", () => {
    const contactEvent = {
      kind: "contact_stage_changed" as const,
      from: "prospect",
      to: "engaged",
      snapshot: { id: "c-1", stage: "engaged" },
    };
    expect(
      triggerMatches({ triggerType: "opportunity_stage_changed", triggerConfig: {} }, contactEvent),
    ).toBe(false);
    expect(
      triggerMatches({ triggerType: "contact_stage_changed", triggerConfig: {} }, stageEvent),
    ).toBe(false);
    expect(
      triggerMatches({ triggerType: "contact_stage_changed", triggerConfig: {} }, contactEvent),
    ).toBe(true);
  });
});

describe("dedupe keys", () => {
  it("keys an event firing on the row version, so a retry is one firing", () => {
    const a = automationDedupeKey("opportunity_stage_changed", { version: "2026-09-21T10:00:00Z" });
    const b = automationDedupeKey("opportunity_stage_changed", { version: "2026-09-21T10:00:00Z" });
    expect(a).toBe(b);
    // A genuine second edit carries a new version and is a new firing.
    expect(automationDedupeKey("opportunity_stage_changed", { version: "2026-09-21T11:00:00Z" })).not.toBe(a);
  });

  it("never collides two versionless firings onto one key", () => {
    const a = automationDedupeKey("opportunity_created", { version: null, now: new Date("2026-09-21T10:00:00Z") });
    const b = automationDedupeKey("opportunity_created", { version: null, now: new Date("2026-09-21T10:00:01Z") });
    expect(a).not.toBe(b);
  });

  it("keys a scheduled firing on the UTC day", () => {
    const morning = automationDedupeKey("opportunity_idle", { now: new Date("2026-09-21T01:00:00Z") });
    const evening = automationDedupeKey("opportunity_idle", { now: new Date("2026-09-21T23:00:00Z") });
    expect(morning).toBe(evening);
    expect(automationDedupeKey("opportunity_idle", { now: new Date("2026-09-22T00:30:00Z") })).not.toBe(morning);
  });

  it("uses UTC days, not the runner's local ones", () => {
    // 2026-09-21T23:30Z is already the 22nd in Sydney and still the 21st in
    // New York. The key has to say 21 either way, or the sweep would raise a
    // second follow-up on whichever side of midnight the server happens to be.
    expect(automationDedupeKey("contact_going_cold", { now: new Date("2026-09-21T23:30:00Z") })).toContain(
      "2026-09-21",
    );
  });

  it("keeps two triggers on the same row apart", () => {
    const now = new Date("2026-09-21T09:00:00Z");
    expect(automationDedupeKey("opportunity_idle", { now })).not.toBe(
      automationDedupeKey("close_date_approaching", { now }),
    );
  });
});

describe("templates", () => {
  it("substitutes the tokens it knows", () => {
    expect(renderTemplate("Follow up on {{name}}", templateValues(DEAL))).toBe(
      "Follow up on Meridian Partners — Fund III",
    );
  });

  it("leaves an unknown token visible rather than blanking it", () => {
    // A typo that renders as "Chase  before " hides itself in the one place
    // somebody would look to find it.
    expect(renderTemplate("Chase {{nmae}} before {{close_date}}", templateValues(DEAL))).toBe(
      "Chase {{nmae}} before 2026-12-31",
    );
  });

  it("formats the amount as money in the deal's own currency", () => {
    expect(renderTemplate("{{amount}}", templateValues(DEAL))).toBe("$5,000,000");
    expect(renderTemplate("{{amount}}", templateValues({ ...DEAL, currency: "EUR" }))).toBe(
      "€5,000,000",
    );
  });

  it("survives a currency code Intl does not know", () => {
    const rendered = renderTemplate("{{amount}}", templateValues({ ...DEAL, currency: "XX" }));
    expect(rendered).toContain("5,000,000");
  });

  it("leaves the token when the value is missing", () => {
    expect(renderTemplate("Close by {{close_date}}", templateValues({ ...DEAL, expected_close: null }))).toBe(
      "Close by {{close_date}}",
    );
  });

  it("passes trigger extras through, like the day threshold", () => {
    expect(renderTemplate("Quiet for {{days}} days", templateValues(DEAL, { days: 21 }))).toBe(
      "Quiet for 21 days",
    );
  });
});

describe("planning", () => {
  const now = new Date("2026-09-21T12:00:00.000Z");

  it("renders a task and dates it from the clock", () => {
    const { planned } = planActions(
      [{ type: "create_task", title: "Chase {{name}}", dueInDays: 3, priority: "high" }],
      { snapshot: DEAL, ruleAuthorId: "admin-1", now },
    );
    expect(planned).toHaveLength(1);
    expect(planned[0]).toMatchObject({
      type: "create_task",
      title: "Chase Meridian Partners — Fund III",
      priority: "high",
      assigneeId: "user-a",
    });
    expect((planned[0] as { dueAt: string }).dueAt).toBe(addDays(now, 3).toISOString());
  });

  it("falls back to the rule's author when the row has no owner", () => {
    // A follow-up assigned to nobody is a follow-up nobody does.
    const { planned } = planActions([{ type: "create_task", title: "Chase" }], {
      snapshot: { ...DEAL, owner_id: null },
      ruleAuthorId: "admin-1",
      now,
    });
    expect((planned[0] as { assigneeId: string }).assigneeId).toBe("admin-1");
  });

  it("honours an explicit unassigned", () => {
    const { planned } = planActions(
      [{ type: "create_task", title: "Chase", assignee: "unassigned" }],
      { snapshot: DEAL, ruleAuthorId: "admin-1", now },
    );
    expect((planned[0] as { assigneeId: string | null }).assigneeId).toBeNull();
  });

  it("drops a no-op rather than applying it", () => {
    // Applying a stage move to the stage the row is already in would bump
    // updated_at, which is the dedupe key for every event rule on that row.
    const { planned, skipped } = planActions(
      [
        { type: "set_stage", stage: "diligence" },
        { type: "add_tag", tag: "institutional" },
        { type: "set_owner", ownerId: "user-a" },
      ],
      { snapshot: DEAL, ruleAuthorId: "admin-1", now },
    );
    expect(planned).toHaveLength(0);
    expect(skipped.map((s) => s.action).sort()).toEqual(["add_tag", "set_owner", "set_stage"]);
  });

  it("skips an action whose text renders empty, and keeps the rest", () => {
    const { planned, skipped } = planActions(
      [
        { type: "create_task", title: "   " },
        { type: "log_activity", subject: "Reviewed {{name}}" },
      ],
      { snapshot: DEAL, ruleAuthorId: "admin-1", now },
    );
    expect(planned).toHaveLength(1);
    expect(planned[0]).toMatchObject({ type: "log_activity", subject: "Reviewed Meridian Partners — Fund III" });
    expect(skipped).toEqual([{ action: "create_task", reason: "The task title is empty." }]);
  });

  it("bounds what a rule can write into a title", () => {
    const { planned } = planActions([{ type: "create_task", title: "x".repeat(500) }], {
      snapshot: DEAL,
      ruleAuthorId: "admin-1",
      now,
    });
    expect((planned[0] as { title: string }).title).toHaveLength(300);
  });

  it("leaves a task with no due date when the rule sets none", () => {
    const { planned } = planActions([{ type: "create_task", title: "Chase" }], {
      snapshot: DEAL,
      ruleAuthorId: "admin-1",
      now,
    });
    expect((planned[0] as { dueAt: string | null }).dueAt).toBeNull();
  });
});

describe("validation", () => {
  const ok: Action[] = [{ type: "create_task", title: "Chase {{name}}" }];

  it("accepts a well-formed rule", () => {
    const result = validateAutomationBody(
      "opportunity_stage_changed",
      { toStage: "diligence" },
      [{ field: "target_amount", op: "gte", value: 1_000_000 }],
      ok,
      { stages: OPPORTUNITY_STAGES },
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.triggerConfig).toEqual({ toStage: "diligence" });
      expect(result.value.conditions).toHaveLength(1);
      expect(result.value.actions).toHaveLength(1);
    }
  });

  it("refuses a rule that does nothing", () => {
    const result = validateAutomationBody("opportunity_created", {}, [], []);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.join(" ")).toContain("at least one action");
  });

  it("refuses a stage that does not exist on the object", () => {
    const result = validateAutomationBody(
      "opportunity_stage_changed",
      { toStage: "nurturing" },
      [],
      ok,
      { stages: OPPORTUNITY_STAGES },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.join(" ")).toContain("not a stage");
  });

  it("refuses a stage rule that can never fire", () => {
    const result = validateAutomationBody(
      "opportunity_stage_changed",
      { fromStage: "diligence", toStage: "diligence" },
      [],
      ok,
      { stages: OPPORTUNITY_STAGES },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.join(" ")).toContain("two different stages");
  });

  it("requires a usable day threshold on a scheduled rule", () => {
    expect(validateAutomationBody("opportunity_idle", { days: 0 }, [], ok).ok).toBe(false);
    expect(validateAutomationBody("opportunity_idle", { days: 400 }, [], ok).ok).toBe(false);
    expect(validateAutomationBody("opportunity_idle", { days: 2.5 }, [], ok).ok).toBe(false);
    const good = validateAutomationBody("opportunity_idle", { days: 21 }, [], ok);
    expect(good.ok).toBe(true);
    if (good.ok) expect(good.value.triggerConfig).toEqual({ days: 21 });
  });

  it("defaults a scheduled rule's days rather than rejecting a blank", () => {
    const result = validateAutomationBody("contact_going_cold", {}, [], ok);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.triggerConfig.days).toBe(60);
  });

  it("refuses a condition on a field a rule may not read", () => {
    const result = validateAutomationBody(
      "opportunity_created",
      {},
      [{ field: "notes", op: "contains", value: "secret" }],
      ok,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.join(" ")).toContain("not a field");
  });

  it("refuses a set_field that is not one of this workspace's columns", () => {
    // The point of the allow-list: set_field writes jsonb, and letting a rule
    // name a built-in column would route around every invariant the PATCH
    // route enforces.
    const result = validateAutomationBody(
      "opportunity_created",
      {},
      [],
      [{ type: "set_field", key: "stage", value: "committed" } as Action],
      { customKeys: ["consultant", "ic_date"] },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.join(" ")).toContain("not one of this workspace's columns");
  });

  it("accepts a set_field on a declared column", () => {
    const result = validateAutomationBody(
      "opportunity_created",
      {},
      [],
      [{ type: "set_field", key: "consultant", value: "Cambridge" } as Action],
      { customKeys: ["consultant"] },
    );
    expect(result.ok).toBe(true);
  });

  it("refuses set_stage on a rule that is not about contacts", () => {
    // A deal's stage is tied to status, closed_at and probability by check
    // constraints, so the engine refuses to write it. Accepting the action here
    // meant an admin could save a deal rule that looked right, switch it on,
    // and find every run carrying a failed action.
    const result = validateAutomationBody(
      "opportunity_stage_changed",
      {},
      [],
      [{ type: "set_stage", stage: "committed" } as Action],
      { stages: OPPORTUNITY_STAGES },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.join(" ")).toContain("Only a contact rule can move a stage");
  });

  it("still accepts set_stage on a contact rule", () => {
    // The positive control: without it, a change that refused set_stage
    // everywhere would pass the test above.
    const result = validateAutomationBody(
      "contact_stage_changed",
      {},
      [],
      [{ type: "set_stage", stage: "engaged" } as Action],
      { stages: CONTACT_STAGES },
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.actions[0]).toEqual({ type: "set_stage", stage: "engaged" });
  });

  it("refuses set_stage on a scheduled deal rule too", () => {
    const result = validateAutomationBody(
      "opportunity_idle",
      { days: 21 },
      [],
      [{ type: "set_stage", stage: "passed" } as Action],
      { stages: OPPORTUNITY_STAGES },
    );
    expect(result.ok).toBe(false);
  });

  it("refuses an unknown action type", () => {
    const result = validateAutomationBody("opportunity_created", {}, [], [
      { type: "send_email", to: "lp@example.com" } as unknown as Action,
    ]);
    expect(result.ok).toBe(false);
  });

  it("refuses a comparison with nothing to compare against", () => {
    const result = validateAutomationBody("opportunity_created", {}, [
      { field: "target_amount", op: "gte" },
    ], ok);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.join(" ")).toContain("needs a value");
  });

  it("allows is_empty with no value", () => {
    const result = validateAutomationBody("opportunity_created", {}, [
      { field: "owner_id", op: "is_empty" },
    ], ok);
    expect(result.ok).toBe(true);
  });

  it("caps how much one rule can do", () => {
    const many = Array.from({ length: 9 }, () => ({ type: "create_task", title: "x" })) as Action[];
    const result = validateAutomationBody("opportunity_created", {}, [], many);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.join(" ")).toContain("at most 5 actions");
  });
});

describe("mapping and description", () => {
  it("maps a row, defaulting the jsonb columns", () => {
    const mapped = mapAutomation({
      id: "a-1",
      name: "Diligence follow-up",
      enabled: true,
      trigger_type: "opportunity_stage_changed",
      trigger_config: { toStage: "diligence" },
      conditions: null,
      actions: [{ type: "create_task", title: "Chase" }],
      created_at: "2026-09-01T00:00:00Z",
      updated_at: "2026-09-01T00:00:00Z",
    });
    expect(mapped.conditions).toEqual([]);
    expect(mapped.actions).toHaveLength(1);
    expect(mapped.runCount).toBe(0);
  });

  it("describes a rule from what it will actually do", () => {
    expect(
      describeAutomation({
        triggerType: "opportunity_idle",
        triggerConfig: { days: 21 },
        conditions: [{ field: "stage", op: "eq", value: "diligence" }],
        actions: [{ type: "create_task", title: "Chase" }],
      }),
    ).toBe("A deal goes quiet for 21 days · 1 condition · Create a follow-up task");

    expect(
      describeAutomation({
        triggerType: "close_date_approaching",
        triggerConfig: { days: 14 },
        conditions: [],
        actions: [{ type: "log_activity", subject: "x" }],
      }),
    ).toBe("A deal's close date is within 14 days · Write a timeline entry");
  });
});
