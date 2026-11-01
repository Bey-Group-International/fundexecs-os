import { AUDIT_ACTIONS, auditRow, cleanDetail } from "./lp-audit";

describe("cleanDetail", () => {
  it("keeps short codes, numbers and booleans", () => {
    expect(cleanDetail({ source: "run", carried: 1, emailed: false, kind: "access_code" })).toEqual({ source: "run", carried: 1, emailed: false, kind: "access_code" });
  });

  it("drops free text: anything with spaces, punctuation beyond . _ : -, or too long", () => {
    expect(cleanDetail({ note: "Jo Park asked for it", email: "jo@x.com", long: "a".repeat(65), ok: "a".repeat(64) })).toEqual({ ok: "a".repeat(64) });
  });

  it("drops what isn't a plain value", () => {
    expect(cleanDetail({ n: NaN, i: Infinity, o: { a: 1 }, arr: [1], nul: null, u: undefined, f: () => 1 })).toEqual({});
  });

  it("drops malformed keys", () => {
    expect(cleanDetail({ "Bad Key": 1, "1abc": 1, UPPER: 1, good_key: 1 })).toEqual({ good_key: 1 });
  });

  it("caps the number of keys", () => {
    const many = Object.fromEntries(Array.from({ length: 30 }, (_, i) => [`k${i}`, i]));
    expect(Object.keys(cleanDetail(many))).toHaveLength(12);
  });

  it("returns nothing for a non-object", () => {
    for (const v of [null, undefined, "x", 1, [1, 2]]) expect(cleanDetail(v)).toEqual({});
  });
});

describe("auditRow", () => {
  const base = { orgId: "org-1", sessionId: "s-1", action: "link.created" as const };

  it("stamps a person's id and kind", () => {
    expect(auditRow({ ...base, actorKind: "user", actorId: "u-1", detail: { source: "run" } })).toEqual({
      organization_id: "org-1",
      session_id: "s-1",
      actor_id: "u-1",
      actor_kind: "user",
      action: "link.created",
      detail: { source: "run" },
    });
  });

  it("records the LP and the system with no id, only a kind", () => {
    for (const kind of ["lp", "system"] as const) {
      const row = auditRow({ ...base, action: "code.verified", actorKind: kind });
      expect(row).toMatchObject({ actor_id: null, actor_kind: kind, detail: {} });
    }
  });

  it("refuses a 'user' entry with no person behind it", () => {
    expect(auditRow({ ...base, actorKind: "user", actorId: "" })).toBeNull();
  });

  it("refuses an action it doesn't know, and an entry with no organization or session", () => {
    expect(auditRow({ ...base, action: "made.up" as never, actorKind: "system" })).toBeNull();
    expect(auditRow({ ...base, orgId: "", actorKind: "system" })).toBeNull();
    expect(auditRow({ ...base, sessionId: "", actorKind: "system" })).toBeNull();
  });

  it("never lets free text into the stored detail", () => {
    const row = auditRow({ ...base, actorKind: "system", detail: { reason: "wrong", typed: "123456 is my code" } });
    expect(row?.detail).toEqual({ reason: "wrong" });
  });

  it("doesn't overlap the actions the database triggers write", () => {
    for (const a of AUDIT_ACTIONS) expect(a).not.toMatch(/^(check\.(recorded|updated)|decision\.|consent\.|review\.)/);
  });
});
