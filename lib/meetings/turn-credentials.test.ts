import { createHmac } from "node:crypto";
import {
  DEFAULT_TURN_TTL_SECONDS,
  MAX_TURN_TTL_SECONDS,
  MIN_TURN_TTL_SECONDS,
  buildIceServers,
  cleanCredential,
  hasRelayUrl,
  mintTurnCredential,
  normalizeTtlSeconds,
  parseTurnUrls,
  turnFailureLog,
} from "./turn-credentials";

describe("cleanCredential", () => {
  // A shared secret carrying a trailing newline mints credentials the TURN
  // server rejects, which is indistinguishable from a wrong secret.
  it("strips the whitespace a pasted environment variable carries", () => {
    expect(cleanCredential("  s3cret\n")).toBe("s3cret");
    expect(cleanCredential("\ts3cret ")).toBe("s3cret");
  });

  it("strips one matching pair of surrounding quotes", () => {
    expect(cleanCredential('"s3cret"')).toBe("s3cret");
    expect(cleanCredential("'s3cret'")).toBe("s3cret");
  });

  // A quote on one side only is not a quoting artefact, and a secret really can
  // contain one — removing it would break a value that worked.
  it("leaves an unmatched quote alone", () => {
    expect(cleanCredential('"s3cret')).toBe('"s3cret');
  });

  it("treats empty, blank and absent alike", () => {
    expect(cleanCredential("")).toBeNull();
    expect(cleanCredential("   \n ")).toBeNull();
    expect(cleanCredential(undefined)).toBeNull();
    expect(cleanCredential(null)).toBeNull();
  });
});

describe("parseTurnUrls", () => {
  it("accepts the separators people actually type", () => {
    expect(parseTurnUrls("turn:a.example:3478, turns:a.example:5349"))
      .toEqual(["turn:a.example:3478", "turns:a.example:5349"]);
    expect(parseTurnUrls("turn:a.example:3478\n turns:a.example:5349"))
      .toEqual(["turn:a.example:3478", "turns:a.example:5349"]);
  });

  // A peer connection handed a malformed URL logs nothing useful and simply
  // fails to gather that candidate — the exact silence this work exists to end.
  it("drops anything without an ICE scheme", () => {
    expect(parseTurnUrls("turn:a.example:3478, https://a.example, a.example:3478"))
      .toEqual(["turn:a.example:3478"]);
  });

  it("keeps stun alongside turn", () => {
    expect(parseTurnUrls("stun:a.example:3478 turn:a.example:3478"))
      .toEqual(["stun:a.example:3478", "turn:a.example:3478"]);
  });

  it("deduplicates, so one server is not listed twice", () => {
    expect(parseTurnUrls("turn:a.example:3478,turn:a.example:3478"))
      .toEqual(["turn:a.example:3478"]);
  });

  it("is empty for anything unusable", () => {
    expect(parseTurnUrls("")).toEqual([]);
    expect(parseTurnUrls(undefined)).toEqual([]);
    expect(parseTurnUrls("   ,  ,")).toEqual([]);
  });
});

describe("hasRelayUrl", () => {
  // The distinction that decides whether a guest on CGNAT connects: STUN tells
  // you your address, only TURN carries the media when nothing else can.
  it("is false for a list that can only discover, not relay", () => {
    expect(hasRelayUrl(["stun:a.example:3478"])).toBe(false);
    expect(hasRelayUrl([])).toBe(false);
  });

  it("is true once a relay is present", () => {
    expect(hasRelayUrl(["stun:a.example:3478", "turn:a.example:3478"])).toBe(true);
    expect(hasRelayUrl(["turns:a.example:5349"])).toBe(true);
  });
});

describe("normalizeTtlSeconds", () => {
  it("falls back to the default for anything unreadable", () => {
    expect(normalizeTtlSeconds(undefined)).toBe(DEFAULT_TURN_TTL_SECONDS);
    expect(normalizeTtlSeconds("")).toBe(DEFAULT_TURN_TTL_SECONDS);
    expect(normalizeTtlSeconds("soon")).toBe(DEFAULT_TURN_TTL_SECONDS);
  });

  // A typo must not be able to mint a credential that outlives the meeting by
  // a year, nor one that expires before the call connects.
  it("clamps to something sane", () => {
    expect(normalizeTtlSeconds("1")).toBe(MIN_TURN_TTL_SECONDS);
    expect(normalizeTtlSeconds("99999999")).toBe(MAX_TURN_TTL_SECONDS);
    expect(normalizeTtlSeconds("3600")).toBe(3600);
  });
});

describe("mintTurnCredential", () => {
  const SECRET = "shared-with-coturn";

  // The scheme, pinned against an independently computed HMAC rather than
  // against itself: username is the expiry, password is base64(HMAC-SHA1) over
  // that username. This is what coturn recomputes under `use-auth-secret`, so
  // if this expectation ever changes, every relayed call stops working.
  it("matches the TURN REST scheme coturn implements", () => {
    const out = mintTurnCredential({ secret: SECRET, ttlSeconds: 3600, nowSeconds: 1_700_000_000 });

    expect(out.expiresAt).toBe(1_700_003_600);
    expect(out.username).toBe("1700003600");
    expect(out.credential).toBe(
      createHmac("sha1", SECRET).update("1700003600").digest("base64"),
    );
  });

  it("puts the label in the username, where the TURN server logs it", () => {
    const out = mintTurnCredential({
      secret: SECRET, ttlSeconds: 60, nowSeconds: 1_700_000_000, label: "room-42",
    });
    expect(out.username).toBe("1700000060:room-42");
    expect(out.credential).toBe(
      createHmac("sha1", SECRET).update("1700000060:room-42").digest("base64"),
    );
  });

  // The username is ":"-delimited, so a label carrying a colon would change
  // which part the server reads as the expiry.
  it("strips anything from a label that would confuse the delimiter", () => {
    const out = mintTurnCredential({
      secret: SECRET, ttlSeconds: 60, nowSeconds: 1_700_000_000, label: "ro:om 42/../x",
    });
    expect(out.username).toBe("1700000060:room42..x");
  });

  it("bounds a long label rather than passing it through", () => {
    const out = mintTurnCredential({
      secret: SECRET, ttlSeconds: 60, nowSeconds: 1_700_000_000, label: "a".repeat(200),
    });
    expect(out.username).toBe(`1700000060:${"a".repeat(32)}`);
  });

  it("gives different secrets different credentials for the same username", () => {
    const args = { ttlSeconds: 60, nowSeconds: 1_700_000_000 };
    const a = mintTurnCredential({ ...args, secret: "one" });
    const b = mintTurnCredential({ ...args, secret: "two" });
    expect(a.username).toBe(b.username);
    expect(a.credential).not.toBe(b.credential);
  });
});

describe("buildIceServers", () => {
  const CRED = { username: "1700003600", credential: "sig", expiresAt: 1_700_003_600 };

  // STUN is a public "what is my address" service and rejects requests that try
  // to authenticate, so credentials go on the relay entry only.
  it("credentials the relay and leaves STUN bare", () => {
    const servers = buildIceServers(
      ["stun:a.example:3478", "turn:a.example:3478", "turns:a.example:5349"],
      CRED,
    );
    expect(servers).toEqual([
      { urls: ["stun:a.example:3478"] },
      { urls: ["turn:a.example:3478", "turns:a.example:5349"], username: "1700003600", credential: "sig" },
    ]);
  });

  it("omits a group that has no members", () => {
    expect(buildIceServers(["turn:a.example:3478"], CRED)).toEqual([
      { urls: ["turn:a.example:3478"], username: "1700003600", credential: "sig" },
    ]);
    expect(buildIceServers(["stun:a.example:3478"], CRED)).toEqual([
      { urls: ["stun:a.example:3478"] },
    ]);
    expect(buildIceServers([], CRED)).toEqual([]);
  });
});

describe("turnFailureLog", () => {
  // The line this ultimately replaces was `Metered returned 401`: true, emitted
  // five times over ten weeks, and it told nobody what to do.
  it("names the variables to set and what breaks until they are", () => {
    const log = turnFailureLog("unconfigured");
    expect(log).toMatch(/TURN_URLS/);
    expect(log).toMatch(/TURN_SECRET/);
    expect(log).toMatch(/CGNAT/);
  });

  it("carries the specific misconfiguration rather than a generic complaint", () => {
    const log = turnFailureLog("misconfigured", "TURN_URLS contains no turn: or turns: entry");
    expect(log).toMatch(/no turn: or turns: entry/);
    expect(log).toMatch(/static-auth-secret/);
  });
});
