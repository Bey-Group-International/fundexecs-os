import {
  classifyTurnStatus,
  cleanCredential,
  credentialWasDirty,
  isUsableIceServerList,
  meteredCredentialsUrl,
  turnFailureLog,
} from "./turn-credentials";

describe("cleanCredential", () => {
  // The failure this exists for. Production answered "Metered returned 401"
  // for ten weeks; a value pasted into a dashboard field carrying a trailing
  // newline produces exactly that, from a key that is perfectly valid.
  it("strips the whitespace a pasted environment variable carries", () => {
    expect(cleanCredential("  abc123\n")).toBe("abc123");
    expect(cleanCredential("\tabc123 ")).toBe("abc123");
  });

  // Copied out of a .env line, where the quotes were the file format rather
  // than part of the secret.
  it("strips one matching pair of surrounding quotes", () => {
    expect(cleanCredential('"abc123"')).toBe("abc123");
    expect(cleanCredential("'abc123'")).toBe("abc123");
    expect(cleanCredential(' "abc123" ')).toBe("abc123");
  });

  // A quote on one side only is not a quoting artefact, and a key really can
  // contain one — removing it would break a credential that worked.
  it("leaves an unmatched quote alone", () => {
    expect(cleanCredential('"abc123')).toBe('"abc123');
    expect(cleanCredential("abc123'")).toBe("abc123'");
  });

  // "Set to nothing" and "not set" mean the same thing to the caller.
  it("treats empty, blank and absent as no credential", () => {
    expect(cleanCredential("")).toBeNull();
    expect(cleanCredential("   \n ")).toBeNull();
    expect(cleanCredential('""')).toBeNull();
    expect(cleanCredential(undefined)).toBeNull();
    expect(cleanCredential(null)).toBeNull();
  });
});

describe("credentialWasDirty", () => {
  // Only for the log line, and it earns its place there: an operator told their
  // key has a trailing newline fixes it in ten seconds instead of spending the
  // afternoon regenerating a key that was never the problem.
  it("reports whether the stored value would have been sent as-is", () => {
    expect(credentialWasDirty("abc123")).toBe(false);
    expect(credentialWasDirty("abc123\n")).toBe(true);
    expect(credentialWasDirty('"abc123"')).toBe(true);
    expect(credentialWasDirty("")).toBe(false);
    expect(credentialWasDirty(undefined)).toBe(false);
  });
});

describe("classifyTurnStatus", () => {
  // The distinction the old code did not make: a 401 will still be a 401 in
  // five minutes, a 503 will not, and they are not worth the same response.
  it("separates a refused key from a provider having a bad day", () => {
    expect(classifyTurnStatus(401)).toBe("rejected");
    expect(classifyTurnStatus(403)).toBe("rejected");
    expect(classifyTurnStatus(500)).toBe("unavailable");
    expect(classifyTurnStatus(503)).toBe("unavailable");
    expect(classifyTurnStatus(429)).toBe("unavailable");
    expect(classifyTurnStatus(404)).toBe("unavailable");
  });

  it("accepts the whole 2xx range", () => {
    expect(classifyTurnStatus(200)).toBe("ok");
    expect(classifyTurnStatus(204)).toBe("ok");
  });
});

describe("isUsableIceServerList", () => {
  it("accepts a real server list", () => {
    expect(isUsableIceServerList([{ urls: "turn:relay.example:3478" }])).toBe(true);
    expect(isUsableIceServerList([{ urls: ["turn:a:3478", "turns:a:5349"] }])).toBe(true);
  });

  // A 200 carrying nothing usable is a failure, and handing a peer connection
  // an empty list looks like success at every point that checks it.
  it("rejects the shapes that would pass a bare Array.isArray check", () => {
    expect(isUsableIceServerList([])).toBe(false);
    expect(isUsableIceServerList([{}])).toBe(false);
    expect(isUsableIceServerList([{ urls: "" }])).toBe(false);
    expect(isUsableIceServerList([{ urls: [] }])).toBe(false);
    expect(isUsableIceServerList([null])).toBe(false);
    expect(isUsableIceServerList({ error: "nope" })).toBe(false);
    expect(isUsableIceServerList(null)).toBe(false);
  });

  it("rejects a list where only some entries are usable", () => {
    expect(isUsableIceServerList([{ urls: "turn:a:3478" }, {}])).toBe(false);
  });
});

describe("meteredCredentialsUrl", () => {
  it("builds the documented endpoint", () => {
    expect(meteredCredentialsUrl("fundexecs", "abc123"))
      .toBe("https://fundexecs.metered.live/api/v1/turn/credentials?apiKey=abc123");
  });

  // The key was interpolated raw. Fine for a tidy base64-ish key, silently
  // wrong for one carrying a `+` or an `&` — the provider then answers 401
  // about a credential that is entirely valid.
  it("escapes a key that would otherwise be truncated by the query string", () => {
    const url = meteredCredentialsUrl("fundexecs", "a+b&c=d e");
    expect(url).toContain("apiKey=a%2Bb%26c%3Dd%20e");
    expect(url).not.toContain("&c=d");
  });
});

describe("turnFailureLog", () => {
  // The line this replaces was "Metered returned 401": true, emitted five times
  // over ten weeks, and it told nobody what to do.
  it("names the variable, the cause and the consequence when the key is refused", () => {
    const log = turnFailureLog({ reason: "rejected", status: 401, appName: "fundexecs", dirty: false });
    expect(log).toMatch(/METERED_API_KEY/);
    expect(log).toMatch(/METERED_APP_NAME="fundexecs"/);
    expect(log).toMatch(/401/);
    expect(log).toMatch(/STUN only/);
  });

  it("says when the stored value needed cleaning, so the key is not blamed first", () => {
    const dirty = turnFailureLog({ reason: "rejected", status: 401, appName: "fundexecs", dirty: true });
    expect(dirty).toMatch(/whitespace or quotes/i);
    const clean = turnFailureLog({ reason: "rejected", status: 401, appName: "fundexecs", dirty: false });
    expect(clean).toMatch(/exactly as stored/i);
  });

  it("distinguishes never-configured from refused", () => {
    const log = turnFailureLog({ reason: "unconfigured", appName: "fundexecs", dirty: false });
    expect(log).toMatch(/not set/i);
    expect(log).not.toMatch(/REJECTED/);
  });

  it("keeps a transient provider failure from reading like a misconfiguration", () => {
    const log = turnFailureLog({ reason: "unavailable", status: 503, appName: "fundexecs", dirty: false });
    expect(log).toMatch(/503/);
    expect(log).not.toMatch(/REJECTED/);
  });
});
