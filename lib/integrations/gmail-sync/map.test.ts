import {
  addressList,
  htmlToText,
  isAutomatedSender,
  mapGmailMessage,
  stripQuotedReply,
  type GmailMessage,
} from "./map";

const MAILBOX = "deals@fund.com";

function b64(text: string): string {
  return Buffer.from(text, "utf8").toString("base64url");
}

function message(overrides: {
  headers?: Record<string, string>;
  labels?: string[];
  text?: string;
  html?: string;
  id?: string;
}): GmailMessage {
  const headers = {
    From: "Ana Lopez <Ana@Acme.com>",
    To: MAILBOX,
    Subject: "Re: Series B terms",
    "Message-ID": "<m1@acme.com>",
    ...overrides.headers,
  };
  const parts = [];
  if (overrides.text !== undefined) parts.push({ mimeType: "text/plain", body: { data: b64(overrides.text) } });
  if (overrides.html !== undefined) parts.push({ mimeType: "text/html", body: { data: b64(overrides.html) } });
  return {
    id: overrides.id ?? "msg1",
    threadId: "thr1",
    labelIds: overrides.labels ?? ["INBOX", "CATEGORY_PERSONAL"],
    internalDate: String(Date.parse("2026-10-01T09:00:00Z")),
    snippet: "snippet text",
    payload: {
      mimeType: "multipart/alternative",
      headers: Object.entries(headers).map(([name, value]) => ({ name, value })),
      parts,
    },
  };
}

describe("mapGmailMessage", () => {
  it("maps an inbound message onto the Resend thread key, lowercased", () => {
    const r = mapGmailMessage(message({ text: "Happy to proceed." }), MAILBOX);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.event.eventId).toBe("gmail:msg1");
    expect(r.event.thread.counterpartyEmail).toBe("ana@acme.com");
    expect(r.event.thread.counterpartyName).toBe("Ana Lopez");
    expect(r.event.thread.threadKey).toBe("email:ana@acme.com:series b terms");
    expect(r.event.message.direction).toBe("inbound");
    expect(r.event.message.body).toBe("Happy to proceed.");
    expect(r.event.message.occurredAt).toBe("2026-10-01T09:00:00.000Z");
  });

  it("treats mail from the mailbox as outbound, with the recipient as counterparty", () => {
    const r = mapGmailMessage(
      message({
        headers: { From: `Deals <${MAILBOX}>`, To: "Ana Lopez <ana@acme.com>", Cc: MAILBOX },
        labels: ["SENT"],
        text: "Sending the deck.",
      }),
      MAILBOX,
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.event.message.direction).toBe("outbound");
    expect(r.event.thread.counterpartyEmail).toBe("ana@acme.com");
    expect(r.event.message.author).toBe("Deals");
  });

  it.each([
    ["promotions", { labels: ["INBOX", "CATEGORY_PROMOTIONS"] }, "label"],
    ["spam", { labels: ["SPAM"] }, "label"],
    ["a draft", { labels: ["DRAFT"] }, "label"],
    ["a mailing list", { headers: { "List-Unsubscribe": "<mailto:x>" } }, "bulk"],
    ["bulk precedence", { headers: { Precedence: "bulk" } }, "bulk"],
    ["an auto-reply", { headers: { "Auto-Submitted": "auto-replied" } }, "bulk"],
    ["a no-reply sender", { headers: { From: "no-reply@vendor.com" } }, "automated_sender"],
    ["mail this app sent", { headers: { "X-FundExecs-Origin": "1" } }, "sent_by_app"],
  ])("skips %s", (_label, overrides, reason) => {
    const r = mapGmailMessage(message({ text: "x", ...overrides }), MAILBOX);
    expect(r).toEqual({ ok: false, reason });
  });

  it("skips a note to self, which has nobody on the other end", () => {
    const r = mapGmailMessage(
      message({ headers: { From: MAILBOX, To: MAILBOX }, labels: ["SENT"], text: "x" }),
      MAILBOX,
    );
    expect(r).toEqual({ ok: false, reason: "no_counterparty" });
  });

  it("falls back to the HTML part, then to the snippet", () => {
    const html = mapGmailMessage(message({ html: "<p>Hello<br>there</p>" }), MAILBOX);
    expect(html.ok && html.event.message.body).toBe("Hello\nthere");
    const bare = mapGmailMessage(message({}), MAILBOX);
    expect(bare.ok && bare.event.message.body).toBe("snippet text");
  });

  it("refuses a message with no id or payload", () => {
    expect(mapGmailMessage({}, MAILBOX)).toEqual({ ok: false, reason: "malformed" });
  });
});

describe("stripQuotedReply", () => {
  it("drops the quoted history under a reply", () => {
    const text = "Sounds good.\n\nOn Tue, 1 Oct 2026 at 09:00, Ana <ana@acme.com> wrote:\n> earlier\n> text";
    expect(stripQuotedReply(text)).toBe("Sounds good.");
  });

  it("handles the attribution line wrapped across two lines", () => {
    const text = "Yes.\nOn Tue, 1 Oct 2026 at 09:00, Ana Lopez\n<ana@acme.com> wrote:\n> old";
    expect(stripQuotedReply(text)).toBe("Yes.");
  });

  it("keeps a message that is nothing but quote", () => {
    expect(stripQuotedReply("> forwarded line")).toBe("> forwarded line");
  });
});

describe("addressList", () => {
  it("splits on commas outside quoted names", () => {
    expect(addressList('"Lopez, Ana" <ana@acme.com>, bob@x.io, not-an-address')).toEqual([
      { name: "Lopez, Ana", email: "ana@acme.com" },
      { name: null, email: "bob@x.io" },
    ]);
  });
});

describe("helpers", () => {
  it("recognises automated senders by local part only", () => {
    expect(isAutomatedSender("noreply@x.com")).toBe(true);
    expect(isAutomatedSender("notifications+abc@github.com")).toBe(true);
    expect(isAutomatedSender("noreen@x.com")).toBe(false);
  });

  it("drops script and style from HTML", () => {
    expect(htmlToText("<style>p{}</style><p>a &amp; b</p>")).toBe("a & b");
  });
});
