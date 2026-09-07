import { applyAdmissionChange, toEntry, type AdmissionChange, type WaitingEntry, type WaitingRow } from "./waiting-room";

const row = (over: Partial<WaitingRow> = {}): WaitingRow => ({
  id: "a1", guest_key: "g1", display_name: "Ada", status: "waiting", ...over,
});

const entry = (over: Partial<WaitingEntry> = {}): WaitingEntry => ({
  id: "a1", from: "g1", displayName: "Ada", ...over,
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
