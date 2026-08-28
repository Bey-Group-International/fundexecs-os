import {
  encodeHeaderValue,
  formatMailbox,
  sanitizeAddress,
  sanitizeHeaderValue,
  sanitizeMimeParam,
} from "./email-headers";

describe("sanitizeHeaderValue", () => {
  it("leaves ordinary text alone", () => {
    expect(sanitizeHeaderValue("Q2 update")).toBe("Q2 update");
  });

  it("removes the CRLF that would end the header", () => {
    expect(sanitizeHeaderValue("Bob\r\nBcc: attacker@evil.test")).toBe(
      "Bob Bcc: attacker@evil.test",
    );
  });

  it("removes a bare LF, which many parsers treat as a line ending too", () => {
    expect(sanitizeHeaderValue("Bob\nBcc: x@evil.test")).toBe("Bob Bcc: x@evil.test");
  });

  it("removes control characters that are not line endings", () => {
    expect(sanitizeHeaderValue("a\u0007b\u0000c\u001Bd")).toBe("a b c d");
  });

  it("collapses a control run to one space rather than several", () => {
    expect(sanitizeHeaderValue("A\r\n\r\nB")).toBe("A B");
  });

  it("keeps words separated, so an injection never fuses into one token", () => {
    // `A\r\nB` becoming `AB` would hide the attempt; `A B` shows it.
    expect(sanitizeHeaderValue("A\r\nB")).toBe("A B");
  });

  it("trims the edges", () => {
    expect(sanitizeHeaderValue("\r\n  spaced  \r\n")).toBe("spaced");
  });
});

describe("encodeHeaderValue", () => {
  it("passes printable ASCII through unchanged", () => {
    expect(encodeHeaderValue("Confirmed: Intro Call")).toBe("Confirmed: Intro Call");
  });

  it("encodes non-ASCII as an RFC 2047 word", () => {
    expect(encodeHeaderValue("Café")).toBe("=?UTF-8?B?Q2Fmw6k=?=");
  });

  it("round-trips an encoded value", () => {
    const subject = "Réunion confirmée — 15h";
    const m = /^=\?UTF-8\?B\?(.+)\?=$/.exec(encodeHeaderValue(subject));
    expect(Buffer.from(m![1], "base64").toString("utf8")).toBe(subject);
  });

  it("strips control characters before encoding, not after", () => {
    // Otherwise the base64 would decode back into a raw CRLF at the client.
    const encoded = encodeHeaderValue("Café\r\nBcc: x@evil.test");
    const decoded = encoded
      .split("\r\n ")
      .map((w) => Buffer.from(/\?B\?(.+)\?=$/.exec(w)![1], "base64").toString("utf8"))
      .join("");
    expect(decoded).toBe("Café Bcc: x@evil.test");
    expect(decoded).not.toContain("\r");
    expect(decoded).not.toContain("\n");
  });

  it("splits a long value into encoded words within the 75-character limit", () => {
    const words = encodeHeaderValue("é".repeat(120)).split("\r\n ");
    expect(words.length).toBeGreaterThan(1);
    for (const w of words) expect(w.length).toBeLessThanOrEqual(75);
  });

  it("never splits a multi-byte character across two encoded words", () => {
    // Each word must decode on its own; a straddled character decodes to U+FFFD.
    const decoded = encodeHeaderValue("é".repeat(120))
      .split("\r\n ")
      .map((w) => Buffer.from(/\?B\?(.+)\?=$/.exec(w)![1], "base64").toString("utf8"))
      .join("");
    expect(decoded).toBe("é".repeat(120));
    expect(decoded).not.toContain("�");
  });

  it("keeps an emoji's surrogate pair intact across a split", () => {
    const value = "🎉".repeat(40);
    const decoded = encodeHeaderValue(value)
      .split("\r\n ")
      .map((w) => Buffer.from(/\?B\?(.+)\?=$/.exec(w)![1], "base64").toString("utf8"))
      .join("");
    expect(decoded).toBe(value);
  });
});

describe("sanitizeAddress", () => {
  it("leaves a normal address alone", () => {
    expect(sanitizeAddress("lp@acme.test")).toBe("lp@acme.test");
  });

  it("strips the angle brackets that would close the mailbox early", () => {
    expect(sanitizeAddress("a@b.test>, attacker@evil.test")).toBe("a@b.testattacker@evil.test");
  });

  it("strips a CRLF injection", () => {
    expect(sanitizeAddress("a@b.test\r\nBcc: x@evil.test")).toBe("a@b.testBccx@evil.test");
  });
});

describe("formatMailbox", () => {
  it("formats a plain name and address", () => {
    expect(formatMailbox("LP", "lp@acme.test")).toBe("LP <lp@acme.test>");
  });

  it("quotes a name containing a comma, which would otherwise add a recipient", () => {
    expect(formatMailbox("Simmons, Bey", "b@acme.test")).toBe('"Simmons, Bey" <b@acme.test>');
  });

  it("escapes quotes and backslashes inside a quoted name", () => {
    expect(formatMailbox('He said "hi"', "b@acme.test")).toBe('"He said \\"hi\\"" <b@acme.test>');
  });

  it("neutralizes a CRLF injection in the display name", () => {
    const header = formatMailbox("Bob\r\nBcc: attacker@evil.test", "bob@acme.test");
    expect(header).not.toContain("\r");
    expect(header).not.toContain("\n");
    expect(header).toBe('"Bob Bcc: attacker@evil.test" <bob@acme.test>');
  });

  it("encodes a non-ASCII name rather than quoting it", () => {
    // An encoded-word contains no specials, so it needs no quoting on top.
    expect(formatMailbox("Müller", "m@acme.test")).toBe("=?UTF-8?B?TcO8bGxlcg==?= <m@acme.test>");
  });

  it("falls back to a bare address when the name sanitizes to nothing", () => {
    expect(formatMailbox("\r\n", "lp@acme.test")).toBe("lp@acme.test");
  });
});

describe("sanitizeMimeParam", () => {
  it("leaves an ordinary filename alone", () => {
    expect(sanitizeMimeParam("invite.ics")).toBe("invite.ics");
  });

  it("drops the quote that would end the parameter", () => {
    expect(sanitizeMimeParam('a.ics"; x="y')).toBe("a.ics; x=y");
  });

  it("neutralizes a CRLF injection", () => {
    expect(sanitizeMimeParam('a.ics"\r\nBcc: x@evil.test')).toBe("a.ics Bcc: x@evil.test");
  });
});
