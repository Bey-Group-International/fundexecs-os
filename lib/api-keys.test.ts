import {
  generateKeyPair,
  hashSecret,
  secretPrefix,
  secretLast4,
  maskedSecret,
  looksLikeSecretKey,
  extractApiKey,
} from "@/lib/api-keys";

describe("api-keys", () => {
  describe("generateKeyPair", () => {
    it("mints recognizable, mode-tagged publishable and secret keys", () => {
      const { publishableKey, secretKey } = generateKeyPair("live");
      expect(publishableKey).toMatch(/^fxpk_live_[0-9a-f]{48}$/);
      expect(secretKey).toMatch(/^fxsk_live_[0-9a-f]{48}$/);
    });

    it("encodes test mode in both keys", () => {
      const { publishableKey, secretKey } = generateKeyPair("test");
      expect(publishableKey.startsWith("fxpk_test_")).toBe(true);
      expect(secretKey.startsWith("fxsk_test_")).toBe(true);
    });

    it("produces a unique pair each call", () => {
      const a = generateKeyPair("live");
      const b = generateKeyPair("live");
      expect(a.secretKey).not.toBe(b.secretKey);
      expect(a.publishableKey).not.toBe(b.publishableKey);
    });
  });

  describe("hashSecret", () => {
    it("is deterministic and trims surrounding whitespace", () => {
      expect(hashSecret("  fxsk_live_abc  ")).toBe(hashSecret("fxsk_live_abc"));
    });

    it("produces a 64-char hex digest that is not the input", () => {
      const hash = hashSecret("fxsk_live_secret");
      expect(hash).toMatch(/^[0-9a-f]{64}$/);
      expect(hash).not.toContain("secret");
    });

    it("differs for different inputs", () => {
      expect(hashSecret("a")).not.toBe(hashSecret("b"));
    });
  });

  describe("display helpers", () => {
    it("derives the non-secret prefix", () => {
      expect(secretPrefix("fxsk_live_0123456789abcdef")).toBe("fxsk_live");
    });

    it("derives the last 4 chars", () => {
      expect(secretLast4("fxsk_live_0123456789abcd")).toBe("abcd");
    });

    it("masks the middle of the secret", () => {
      expect(maskedSecret("fxsk_live", "abcd")).toBe("fxsk_live_••••••••abcd");
    });
  });

  describe("looksLikeSecretKey", () => {
    it("accepts well-formed secret keys", () => {
      const { secretKey } = generateKeyPair("test");
      expect(looksLikeSecretKey(secretKey)).toBe(true);
    });

    it("rejects publishable keys and junk", () => {
      const { publishableKey } = generateKeyPair("live");
      expect(looksLikeSecretKey(publishableKey)).toBe(false);
      expect(looksLikeSecretKey("not-a-key")).toBe(false);
      expect(looksLikeSecretKey("fxsk_prod_0123")).toBe(false);
    });
  });

  describe("extractApiKey", () => {
    const req = (headers: Record<string, string>) =>
      new Request("https://example.com", { headers });

    it("reads a case-insensitive Bearer token", () => {
      expect(extractApiKey(req({ authorization: "Bearer fxsk_live_x" }))).toBe("fxsk_live_x");
      expect(extractApiKey(req({ authorization: "bearer fxsk_live_y" }))).toBe("fxsk_live_y");
    });

    it("falls back to the x-api-key header", () => {
      expect(extractApiKey(req({ "x-api-key": "fxsk_test_z" }))).toBe("fxsk_test_z");
    });

    it("returns null when no credential is present", () => {
      expect(extractApiKey(req({}))).toBeNull();
    });
  });
});
