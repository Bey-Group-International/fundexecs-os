import { randomBytes } from "crypto";
import {
  FieldDecryptionError,
  FieldEncryptionConfigError,
  decryptField,
  decryptFieldSafe,
  encryptField,
  fieldEncryptionConfigured,
  isEncrypted,
} from "@/lib/crypto/field-encryption";

const k1 = randomBytes(32).toString("base64");
const k2 = randomBytes(32).toString("base64");
const env = { FIELD_ENCRYPTION_KEYS: `k1:${k1}` };
const AAD = "lp_onboarding_profiles.contact_phone:s1";

describe("encryptField / decryptField", () => {
  it("round-trips, including non-ASCII", () => {
    for (const v of ["+1 212 555 0100", "Vente d'une société — 土地", "x".repeat(1000)]) {
      const sealed = encryptField(v, AAD, env)!;
      expect(isEncrypted(sealed)).toBe(true);
      expect(sealed).not.toContain(v.slice(0, 8));
      expect(decryptField(sealed, AAD, env)).toBe(v);
    }
  });

  it("uses a fresh IV, so equal inputs give different ciphertext", () => {
    expect(encryptField("same", AAD, env)).not.toBe(encryptField("same", AAD, env));
  });

  it("rejects ciphertext moved to another row or column (AAD binding)", () => {
    const sealed = encryptField("secret", AAD, env)!;
    expect(() => decryptField(sealed, "lp_onboarding_profiles.contact_phone:s2", env)).toThrow(FieldDecryptionError);
    expect(() => decryptField(sealed, "lp_onboarding_profiles.source_of_funds:s1", env)).toThrow(FieldDecryptionError);
  });

  it("detects tampering", () => {
    const parts = encryptField("secret", AAD, env)!.split(".");
    parts[3] = Buffer.from("tampered!!!!").toString("base64url");
    expect(() => decryptField(parts.join("."), AAD, env)).toThrow(FieldDecryptionError);
  });

  it("returns legacy plaintext and null unchanged", () => {
    expect(decryptField("+1 212 555 0100", AAD, env)).toBe("+1 212 555 0100");
    expect(decryptField(null, AAD, env)).toBeNull();
    expect(encryptField(null, AAD, env)).toBeNull();
    expect(encryptField("", AAD, env)).toBe("");
  });

  it("reports malformed values and unknown keys", () => {
    expect(() => decryptField("fx1.only.three", AAD, env)).toThrow(FieldDecryptionError);
    const sealed = encryptField("secret", AAD, env)!;
    expect(() => decryptField(sealed, AAD, { FIELD_ENCRYPTION_KEYS: `other:${k2}` })).toThrow(/unknown_key/);
  });
});

describe("key rotation", () => {
  it("writes with the first key and still reads values from the older one", () => {
    const old = encryptField("before rotation", AAD, { FIELD_ENCRYPTION_KEYS: `k1:${k1}` })!;
    const rotated = { FIELD_ENCRYPTION_KEYS: `k2:${k2},k1:${k1}` };
    expect(decryptField(old, AAD, rotated)).toBe("before rotation");
    expect(encryptField("after", AAD, rotated)!.split(".")[1]).toBe("k2");
  });
});

describe("configuration", () => {
  it("stays plaintext when no key is set and encryption is not required", () => {
    jest.spyOn(console, "warn").mockImplementation(() => {});
    expect(fieldEncryptionConfigured({})).toBe(false);
    expect(encryptField("plain", AAD, {})).toBe("plain");
  });
  it("refuses to write plaintext when required", () => {
    expect(() => encryptField("plain", AAD, { FIELD_ENCRYPTION_REQUIRED: "on" })).toThrow(FieldEncryptionConfigError);
  });
  it("rejects a key of the wrong length", () => {
    expect(() => encryptField("x", AAD, { FIELD_ENCRYPTION_KEYS: `k1:${Buffer.alloc(16).toString("base64")}` })).toThrow(/32 bytes/);
  });
});

describe("decryptFieldSafe", () => {
  it("returns null and never logs the value", () => {
    const spy = jest.spyOn(console, "error").mockImplementation(() => {});
    const sealed = encryptField("secret-value", AAD, env)!;
    expect(decryptFieldSafe(sealed, "wrong-aad", env)).toBeNull();
    expect(JSON.stringify(spy.mock.calls)).not.toContain("secret-value");
    spy.mockRestore();
  });
});
