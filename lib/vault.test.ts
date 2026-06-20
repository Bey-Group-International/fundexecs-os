import { encryptSecret, decryptSecret, vaultConfigured } from "@/lib/vault";

describe("vault", () => {
  const ORIGINAL = process.env.FUNDEXECS_VAULT_KEY;

  afterEach(() => {
    if (ORIGINAL === undefined) delete process.env.FUNDEXECS_VAULT_KEY;
    else process.env.FUNDEXECS_VAULT_KEY = ORIGINAL;
  });

  it("reports configuration state from the env var", () => {
    delete process.env.FUNDEXECS_VAULT_KEY;
    expect(vaultConfigured()).toBe(false);
    process.env.FUNDEXECS_VAULT_KEY = "some-key";
    expect(vaultConfigured()).toBe(true);
  });

  it("round-trips a secret through encrypt/decrypt", () => {
    process.env.FUNDEXECS_VAULT_KEY = "test-vault-key";
    const plaintext = "sk-ant-super-secret-value";
    const encrypted = encryptSecret(plaintext);
    expect(encrypted.ciphertext).not.toContain(plaintext);
    expect(decryptSecret(encrypted)).toBe(plaintext);
  });

  it("uses a fresh IV per call, so identical plaintext yields different ciphertext", () => {
    process.env.FUNDEXECS_VAULT_KEY = "test-vault-key";
    const a = encryptSecret("same");
    const b = encryptSecret("same");
    expect(a.ciphertext).not.toBe(b.ciphertext);
    expect(a.iv).not.toBe(b.iv);
  });

  it("fails to decrypt when the auth tag is tampered with", () => {
    process.env.FUNDEXECS_VAULT_KEY = "test-vault-key";
    const enc = encryptSecret("secret");
    const tampered = { ...enc, authTag: Buffer.from("0".repeat(16)).toString("base64") };
    expect(() => decryptSecret(tampered)).toThrow();
  });

  it("fails to decrypt under a different key", () => {
    process.env.FUNDEXECS_VAULT_KEY = "key-one";
    const enc = encryptSecret("secret");
    process.env.FUNDEXECS_VAULT_KEY = "key-two";
    expect(() => decryptSecret(enc)).toThrow();
  });

  it("throws when the vault key is unset", () => {
    delete process.env.FUNDEXECS_VAULT_KEY;
    expect(() => encryptSecret("x")).toThrow(/FUNDEXECS_VAULT_KEY/);
  });
});
