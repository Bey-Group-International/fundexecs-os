import { daysWaiting, groupSignatureTasks, signatureLoadError, signatureSummary, waitingLabel, type SignatureTask } from "@/lib/data-room-signatures";

const task = (id: string, roomId: string, signedAt: string | null, over: Partial<SignatureTask> = {}): SignatureTask => ({
  key: `legacy:${id}`,
  kind: "legacy",
  id,
  title: `Doc ${id}`,
  roomId,
  roomName: `Room ${roomId}`,
  signerName: "A Reader",
  signerEmail: "a@example.com",
  signedAt,
  ...over,
});

describe("groupSignatureTasks", () => {
  it("groups by room, keeping rooms in first-seen order", () => {
    const g = groupSignatureTasks([task("1", "b", "2026-10-02T00:00:00Z"), task("2", "a", "2026-10-01T00:00:00Z"), task("3", "b", "2026-10-03T00:00:00Z")]);
    expect(g.map((x) => x.roomId)).toEqual(["b", "a"]);
    expect(g[0].tasks).toHaveLength(2);
  });

  it("lists the longest-waiting first within a room", () => {
    const g = groupSignatureTasks([task("new", "a", "2026-10-09T00:00:00Z"), task("old", "a", "2026-10-01T00:00:00Z")]);
    expect(g[0].tasks.map((t) => t.id)).toEqual(["old", "new"]);
  });

  it("puts a task with an unknown signing time last", () => {
    const g = groupSignatureTasks([task("unknown", "a", null), task("known", "a", "2026-10-01T00:00:00Z")]);
    expect(g[0].tasks.map((t) => t.id)).toEqual(["known", "unknown"]);
  });

  it("returns no groups for no tasks", () => {
    expect(groupSignatureTasks([])).toEqual([]);
  });
});

describe("signatureSummary", () => {
  it("says so plainly when nothing is waiting", () => {
    expect(signatureSummary(0)).toBe("Nothing needs your signature.");
  });
  it("agrees in number", () => {
    expect(signatureSummary(1)).toBe("1 document needs your signature.");
    expect(signatureSummary(3)).toBe("3 documents need your signature.");
  });
});

describe("daysWaiting / waitingLabel", () => {
  const now = new Date("2026-10-10T12:00:00Z");
  it("counts whole days", () => {
    expect(daysWaiting("2026-10-07T13:00:00Z", now)).toBe(2);
    expect(daysWaiting("2026-10-10T01:00:00Z", now)).toBe(0);
  });
  it("is never negative and null when unknown", () => {
    expect(daysWaiting("2026-10-12T00:00:00Z", now)).toBe(0);
    expect(daysWaiting(null, now)).toBeNull();
    expect(daysWaiting("not a date", now)).toBeNull();
  });
  it("words it", () => {
    expect(waitingLabel(null)).toBe("");
    expect(waitingLabel(0)).toBe("signed today");
    expect(waitingLabel(1)).toBe("waiting 1 day");
    expect(waitingLabel(5)).toBe("waiting 5 days");
  });
});

describe("signatureLoadError", () => {
  it("uses the error's own message", () => {
    expect(signatureLoadError(new Error("Couldn't load the room signatures: boom"))).toBe("Couldn't load the room signatures: boom");
  });
  it("is never empty, so a failed read cannot read as no error", () => {
    expect(signatureLoadError(new Error(""))).not.toBe("");
    expect(signatureLoadError(new Error("   "))).not.toBe("");
    expect(signatureLoadError("a string")).not.toBe("");
    expect(signatureLoadError(undefined)).not.toBe("");
  });
});
