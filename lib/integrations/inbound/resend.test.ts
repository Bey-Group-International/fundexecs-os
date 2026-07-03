// Coverage for Resend inbound (audit P1 #15 — inbound ingestion). The Svix
// signature scheme (base64 HMAC over `id.timestamp.body`, whsec_-prefixed
// base64 secret, multiple rotation candidates) must be verified exactly, and
// the mapper must thread reply emails ("Re: …") with their original while
// ignoring outbound delivery-status events.
import { createHmac } from "crypto";
import {
  verifyResendSignature,
  mapResendEvent,
  normalizeSubject,
  parseAddress,
} from "./resend";

const RAW_KEY = Buffer.from("resend-signing-key-0123456789ab");
const SECRET = `whsec_${RAW_KEY.toString("base64")}`;

function sign(
  body: string,
  { id = "msg_1", atMs = Date.now(), key = RAW_KEY, extra = "" } = {},
): Headers {
  const timestamp = String(Math.floor(atMs / 1000));
  const sig = createHmac("sha256", key).update(`${id}.${timestamp}.${body}`).digest("base64");
  return new Headers({
    "svix-id": id,
    "svix-timestamp": timestamp,
    "svix-signature": `${extra}v1,${sig}`,
  });
}

describe("verifyResendSignature", () => {
  const body = JSON.stringify({ type: "email.received" });

  it("accepts a fresh, correctly-signed payload", () => {
    expect(verifyResendSignature(body, sign(body), SECRET)).toBe(true);
  });

  it("accepts when a valid candidate follows a rotated (stale) one", () => {
    const headers = sign(body, { extra: "v1,AAAAinvalidAAAA= " });
    expect(verifyResendSignature(body, headers, SECRET)).toBe(true);
  });

  it("rejects a signature minted with a different key", () => {
    const headers = sign(body, { key: Buffer.from("some-other-key-0123456789abcdef") });
    expect(verifyResendSignature(body, headers, SECRET)).toBe(false);
  });

  it("rejects a tampered body and a stale timestamp", () => {
    expect(verifyResendSignature(body + "x", sign(body), SECRET)).toBe(false);
    const stale = sign(body, { atMs: Date.now() - 10 * 60 * 1000 });
    expect(verifyResendSignature(body, stale, SECRET)).toBe(false);
  });

  it("rejects when headers or the secret are missing", () => {
    expect(verifyResendSignature(body, new Headers(), SECRET)).toBe(false);
    expect(verifyResendSignature(body, sign(body), "")).toBe(false);
  });
});

describe("normalizeSubject / parseAddress", () => {
  it("strips stacked reply/forward prefixes and normalizes whitespace/case", () => {
    expect(normalizeSubject("Re: RE: Fwd: Q3   Update")).toBe("q3 update");
    expect(normalizeSubject("Q3 Update")).toBe("q3 update");
  });

  it("parses display-name and bare addresses", () => {
    expect(parseAddress('"Dana LP" <Dana@LP.test>')).toEqual({
      name: "Dana LP",
      email: "dana@lp.test",
    });
    expect(parseAddress("dana@lp.test")).toEqual({ name: null, email: "dana@lp.test" });
    expect(parseAddress("Dana")).toEqual({ name: "Dana", email: null });
  });
});

describe("mapResendEvent", () => {
  const received = {
    type: "email.received",
    created_at: "2026-07-03T09:00:00Z",
    data: {
      email_id: "em_1",
      from: "Dana LP <dana@lp.test>",
      to: ["ir@fund.test"],
      subject: "Q3 Update",
      text: "Could you send the latest deck?",
    },
  };

  it("maps email.received to a messaging thread on the email lane", () => {
    const event = mapResendEvent(received)!;
    expect(event.eventId).toBe("em_1");
    expect(event.thread.channel).toBe("gmail");
    expect(event.thread.category).toBe("messaging");
    expect(event.thread.counterpartyEmail).toBe("dana@lp.test");
    expect(event.message.body).toBe("Could you send the latest deck?");
    expect(event.message.metadata).toMatchObject({ via: "resend", email_id: "em_1" });
  });

  it("threads a reply with the original via the normalized subject key", () => {
    const reply = {
      ...received,
      data: { ...received.data, email_id: "em_2", subject: "Re: Q3 Update" },
    };
    const a = mapResendEvent(received)!;
    const b = mapResendEvent(reply)!;
    expect(b.thread.threadKey).toBe(a.thread.threadKey);
    expect(b.eventId).not.toBe(a.eventId);
  });

  it("ignores outbound delivery-status events", () => {
    expect(mapResendEvent({ type: "email.sent", data: { email_id: "em_9" } })).toBeNull();
    expect(mapResendEvent({ type: "email.bounced", data: { email_id: "em_9" } })).toBeNull();
  });

  it("throws on email.received with no email_id", () => {
    expect(() => mapResendEvent({ type: "email.received", data: {} })).toThrow(/email_id/);
  });
});
