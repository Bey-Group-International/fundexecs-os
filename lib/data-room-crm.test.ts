import { followUpHtml, readingRollups, recentDays, templateFollowUp } from "./data-room-crm";
import type { TimelineEntry } from "./data-room-engagement";

const t = (o: Partial<TimelineEntry>): TimelineEntry => ({
  day: "2026-10-02",
  documentId: "ppm",
  name: "PPM v3",
  seconds: 0,
  opens: 0,
  downloads: 0,
  lastAt: "2026-10-02T09:00:00Z",
  ...o,
});
const room = { id: "room-1", name: "Fund II" };

describe("readingRollups", () => {
  it("writes one entry per day: what they read, for how long, and what they downloaded", () => {
    const [r] = readingRollups(
      {
        timeline: [
          t({ seconds: 600, downloads: 1, lastAt: "2026-10-02T10:00:00Z" }),
          t({ documentId: "deck", name: "Deck", seconds: 120 }),
          t({ day: "2026-09-01", seconds: 999 }),
        ],
      },
      room,
      ["2026-10-02"],
    );
    expect(r).toEqual({
      key: "room-1:2026-10-02",
      day: "2026-10-02",
      subject: "Read the Fund II data room (12 min)",
      body: "PPM v3 · read 10 min · downloaded\nDeck · read 2 min",
      occurredAt: "2026-10-02T10:00:00Z",
      seconds: 720,
    });
  });

  it("records a bare open of the room", () => {
    const [r] = readingRollups({ timeline: [t({ documentId: null, name: "Room overview", seconds: 30 })] }, room, ["2026-10-02"]);
    expect(r.subject).toBe("Opened the Fund II data room");
    expect(r.body).toBe("Opened the room.");
  });

  it("skips days with nothing", () => {
    expect(readingRollups({ timeline: [t({})] }, room, ["2026-10-01"])).toEqual([]);
  });
});

it("keeps today and yesterday current", () => {
  expect(recentDays(new Date("2026-10-02T13:00:00Z"))).toEqual(["2026-10-01", "2026-10-02"]);
});

describe("templateFollowUp", () => {
  it("names what they read and signs off as the sender", () => {
    const d = templateFollowUp(
      {
        documents: [
          { documentId: "ppm", name: "PPM v3", seconds: 600, opens: 0, downloads: 0 },
          { documentId: "deck", name: "Deck", seconds: 0, opens: 1, downloads: 0 },
        ],
        downloads: 0,
      },
      { roomName: "Fund II", recipientName: "Jane Doe", senderName: "Sam Lee", nextStep: null },
    );
    expect(d.subject).toBe("Following up on Fund II");
    expect(d.body).toContain("Hi Jane,");
    expect(d.body).toContain("you had a look at PPM v3 in our Fund II data room");
    expect(d.body).not.toContain("Deck");
    expect(d.body.endsWith("Best,\nSam Lee")).toBe(true);
    expect(d.source).toBe("template");
  });
});

it("turns the edited text into safe HTML paragraphs", () => {
  expect(followUpHtml("Hi <b>Jane</b>,\n\nLine one\nline two")).toContain(
    '<p style="margin: 0 0 12px;">Hi &lt;b&gt;Jane&lt;/b&gt;,</p><p style="margin: 0 0 12px;">Line one<br />line two</p>',
  );
});
