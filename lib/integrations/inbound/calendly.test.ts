// Coverage for Calendly inbound (audit P1 #15 — inbound ingestion). The
// signature check must be exact (HMAC over `t.body`, timing-safe, stale
// timestamps rejected) because this endpoint writes to the org's inbox; the
// mapper must thread created/canceled events for one booking together and
// clear the held meeting time on cancellation.
import { createHmac } from "crypto";
import { verifyCalendlySignature, mapCalendlyEvent } from "./calendly";

const SECRET = "cal-signing-key";

function sign(body: string, secret: string = SECRET, atMs: number = Date.now()): Headers {
  const t = Math.floor(atMs / 1000);
  const v1 = createHmac("sha256", secret).update(`${t}.${body}`).digest("hex");
  return new Headers({ "calendly-webhook-signature": `t=${t},v1=${v1}` });
}

describe("verifyCalendlySignature", () => {
  const body = JSON.stringify({ event: "invitee.created" });

  it("accepts a fresh, correctly-signed payload", () => {
    expect(verifyCalendlySignature(body, sign(body), SECRET)).toBe(true);
  });

  it("rejects a signature minted with a different secret", () => {
    expect(verifyCalendlySignature(body, sign(body, "wrong-key"), SECRET)).toBe(false);
  });

  it("rejects a tampered body", () => {
    expect(verifyCalendlySignature(body + "x", sign(body), SECRET)).toBe(false);
  });

  it("rejects a stale timestamp (replay window)", () => {
    const tenMinutesAgo = Date.now() - 10 * 60 * 1000;
    expect(verifyCalendlySignature(body, sign(body, SECRET, tenMinutesAgo), SECRET)).toBe(false);
  });

  it("rejects when the header or secret is missing", () => {
    expect(verifyCalendlySignature(body, new Headers(), SECRET)).toBe(false);
    expect(verifyCalendlySignature(body, sign(body), "")).toBe(false);
  });
});

describe("mapCalendlyEvent", () => {
  const created = {
    event: "invitee.created",
    created_at: "2026-07-03T10:00:00Z",
    payload: {
      uri: "https://api.calendly.com/scheduled_events/ev-1/invitees/inv-1",
      name: "Dana LP",
      email: "dana@lp.test",
      reschedule_url: "https://calendly.com/reschedulings/inv-1",
      scheduled_event: {
        uri: "https://api.calendly.com/scheduled_events/ev-1",
        name: "Intro call",
        start_time: "2026-07-10T15:00:00Z",
        location: { join_url: "https://zoom.us/j/123" },
      },
    },
  };

  it("maps invitee.created to a booking thread holding the time and link", () => {
    const event = mapCalendlyEvent(created)!;
    expect(event.eventType).toBe("invitee.created");
    expect(event.thread.channel).toBe("calendly");
    expect(event.thread.category).toBe("booking");
    expect(event.thread.threadKey).toBe("https://api.calendly.com/scheduled_events/ev-1");
    expect(event.thread.counterpartyEmail).toBe("dana@lp.test");
    expect(event.thread.meetingAt).toBe("2026-07-10T15:00:00Z");
    expect(event.thread.meetingUrl).toBe("https://zoom.us/j/123");
    expect(event.message.body).toContain("Dana LP");
    expect(event.message.body).toContain("Intro call");
  });

  it("shares the thread key across created and canceled for one booking, clearing the time", () => {
    const canceled = {
      ...created,
      event: "invitee.canceled",
      payload: { ...created.payload, cancellation: { reason: "Conflict" } },
    };
    const a = mapCalendlyEvent(created)!;
    const b = mapCalendlyEvent(canceled)!;
    expect(b.thread.threadKey).toBe(a.thread.threadKey);
    // Distinct deliveries — the idempotency key must not collide.
    expect(b.eventId).not.toBe(a.eventId);
    expect(b.thread.meetingAt).toBeNull();
    expect(b.thread.meetingUrl).toBeNull();
    expect(b.message.body).toContain("canceled");
    expect(b.message.body).toContain("Conflict");
  });

  it("ignores unsupported event types", () => {
    expect(mapCalendlyEvent({ event: "routing_form_submission.created" })).toBeNull();
  });

  it("throws on a supported event with no correlating uri", () => {
    expect(() => mapCalendlyEvent({ event: "invitee.created", payload: {} })).toThrow(/uri/);
  });
});
