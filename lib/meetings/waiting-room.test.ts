import {
  PRESENCE_GRACE_MS,
  applyAdmissionChange,
  presentOnly,
  stillWaiting,
  toEntry,
  type AdmissionChange,
  type WaitingEntry,
  type WaitingRow,
} from "./waiting-room";

const row = (over: Partial<WaitingRow> = {}): WaitingRow => ({
  id: "a1", guest_key: "g1", display_name: "Ada", status: "waiting", ...over,
});

const entry = (over: Partial<WaitingEntry> = {}): WaitingEntry => ({
  id: "a1", from: "g1", displayName: "Ada", seenAtMs: 0, ...over,
});

const insert = (r: WaitingRow): AdmissionChange => ({ eventType: "INSERT", new: r });
const update = (r: WaitingRow): AdmissionChange => ({ eventType: "UPDATE", new: r });

describe("applyAdmissionChange", () => {
  it("adds a new knock to the end, so the first to knock stays first", () => {
    const before = [entry({ id: "a0", from: "g0", displayName: "Grace" })];
    const after = applyAdmissionChange(before, insert(row()));
    expect(after.map((p) => p.id)).toEqual(["a0", "a1"]);
  });

  it("maps the row onto the shape the panel renders", () => {
    expect(applyAdmissionChange([], insert(row()))).toEqual([entry()]);
    expect(toEntry(row())).toEqual(entry());
  });

  // A teammate is auto-admitted by the knock route, so their INSERT arrives
  // already decided. The host must never have to dismiss their own team.
  it("ignores an insert that is already decided", () => {
    expect(applyAdmissionChange([], insert(row({ status: "admitted" })))).toEqual([]);
  });

  it("drops a guest once they are admitted", () => {
    expect(applyAdmissionChange([entry()], update(row({ status: "admitted" })))).toEqual([]);
  });

  it("drops a guest once they are denied", () => {
    expect(applyAdmissionChange([entry()], update(row({ status: "denied" })))).toEqual([]);
  });

  it("drops a deleted row", () => {
    expect(applyAdmissionChange([entry()], { eventType: "DELETE", old: { id: "a1" } })).toEqual([]);
  });

  // A guest re-knocking under a corrected name updates their row; they should not
  // be sent to the back of a queue they have been in the whole time.
  it("updates a listed guest in place rather than moving them", () => {
    const before = [entry(), entry({ id: "a2", from: "g2", displayName: "Alan" })];
    const after = applyAdmissionChange(before, update(row({ display_name: "Ada Lovelace" })));
    expect(after.map((p) => p.id)).toEqual(["a1", "a2"]);
    expect(after[0].displayName).toBe("Ada Lovelace");
  });

  it("does not duplicate a guest when the same event arrives twice", () => {
    const once = applyAdmissionChange([], insert(row()));
    const twice = applyAdmissionChange(once, insert(row()));
    expect(twice).toHaveLength(1);
  });

  // A decision for someone already gone (a re-delivered event, a host who pressed
  // Admit twice) must not resurrect them.
  it("stays empty when a decision arrives for a guest already removed", () => {
    expect(applyAdmissionChange([], update(row({ status: "admitted" })))).toEqual([]);
  });

  it("never mutates the list it was given", () => {
    const before = [entry()];
    const frozen = Object.freeze([...before]);
    applyAdmissionChange(frozen, insert(row({ id: "a2", guest_key: "g2" })));
    expect(before).toEqual([entry()]);
  });

  it("survives a malformed payload rather than dropping the list", () => {
    const before = [entry()];
    expect(applyAdmissionChange(before, { eventType: "DELETE", old: {} })).toEqual(before);
    expect(applyAdmissionChange(before, { eventType: "INSERT", new: {} as WaitingRow })).toEqual(before);
  });
});

// ── Who is still actually out there ─────────────────────────────────────────

describe("toEntry, on liveness", () => {
  const AT = "2026-09-18T12:00:00.000Z";

  it("takes the last poll as the sign of life", () => {
    expect(toEntry(row({ last_seen_at: AT })).seenAtMs).toBe(Date.parse(AT));
  });

  // Until the first poll lands there is nothing else to go on, and a knock that
  // has only just been inserted must not read as somebody who has gone.
  it("falls back to when they knocked", () => {
    expect(toEntry(row({ created_at: AT })).seenAtMs).toBe(Date.parse(AT));
  });

  it("prefers the poll over the knock", () => {
    const later = "2026-09-18T12:05:00.000Z";
    expect(toEntry(row({ created_at: AT, last_seen_at: later })).seenAtMs).toBe(Date.parse(later));
  });

  it("survives a timestamp it cannot read", () => {
    expect(toEntry(row({ last_seen_at: "not a time" })).seenAtMs).toBe(0);
    expect(toEntry(row({ last_seen_at: null, created_at: null })).seenAtMs).toBe(0);
  });
});

describe("stillWaiting", () => {
  const now = Date.parse("2026-09-18T12:00:00.000Z");

  it("keeps somebody who polled just now", () => {
    expect(stillWaiting(entry({ seenAtMs: now - 2_000 }), now)).toBe(true);
  });

  it("drops somebody who stopped polling", () => {
    expect(stillWaiting(entry({ seenAtMs: now - PRESENCE_GRACE_MS - 1 }), now)).toBe(false);
  });

  // A host shown somebody who IS there is a far smaller error than a host told
  // somebody has gone when they have not, so the boundary is inclusive.
  it("keeps somebody exactly on the boundary", () => {
    expect(stillWaiting(entry({ seenAtMs: now - PRESENCE_GRACE_MS }), now)).toBe(true);
  });

  // No evidence is not evidence of absence: a Realtime INSERT carries no
  // last_seen_at, and flickering every new knock out of the panel on arrival
  // would be worse than the defect this fixes.
  it("keeps somebody there is no evidence about", () => {
    expect(stillWaiting(entry({ seenAtMs: 0 }), now)).toBe(true);
  });

  // A clock that is ahead of ours must not be read as a stale one.
  it("keeps somebody whose timestamp is in the future", () => {
    expect(stillWaiting(entry({ seenAtMs: now + 10_000 }), now)).toBe(true);
  });
});

describe("presentOnly", () => {
  const now = Date.parse("2026-09-18T12:00:00.000Z");

  it("takes out the people who have gone and keeps the order", () => {
    const list = [
      entry({ id: "a1", seenAtMs: now - 1_000 }),
      entry({ id: "a2", seenAtMs: now - PRESENCE_GRACE_MS - 1 }),
      entry({ id: "a3", seenAtMs: now - 2_000 }),
    ];
    expect(presentOnly(list, now).map((p) => p.id)).toEqual(["a1", "a3"]);
  });

  // Filtered at render rather than deleted, so a guest who comes back reappears
  // with their place in the queue rather than having to knock again.
  it("does not mutate the list it was given", () => {
    const list = [entry({ seenAtMs: now - PRESENCE_GRACE_MS - 1 })];
    presentOnly(list, now);
    expect(list).toHaveLength(1);
  });

  it("survives an empty panel", () => {
    expect(presentOnly([], now)).toEqual([]);
  });
});
