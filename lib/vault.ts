// Symmetric encryption for the third-party secret vault (org_secrets). Values
// are stored encrypted at rest so they can be decrypted server-side when used,
// while the UI only ever shows a masked last-4. AES-256-GCM gives us
// confidentiality plus an authentication tag that detects tampering on decrypt.
//
// The key comes from FUNDEXECS_VAULT_KEY (server-only). We derive a fixed
// 32-byte key from it via scrypt (memory-hard KDF, built into Node), so the
// vault resists offline brute-force even if an operator sets a passphrase
// rather than a random token — no specific length/encoding is imposed. The
// salt is static because there is exactly one vault key per deployment; the
// derived key is cached per process so the KDF cost is paid once, not per
// encrypt/decrypt.
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "crypto";

const ALGORITHM = "aes-256-gcm";
const IV_BYTES = 12; // GCM standard nonce length.
const KDF_SALT = "fundexecs-vault-v1";

let cachedKey: { raw: string; key: Buffer } | null = null;

function deriveKey(): Buffer | null {
  const raw = process.env.FUNDEXECS_VAULT_KEY;
  if (!raw) return null;
  if (cachedKey?.raw !== raw) {
    cachedKey = { raw, key: scryptSync(raw, KDF_SALT, 32) };
  }
  return cachedKey.key;
}

/** True when FUNDEXECS_VAULT_KEY is set — gates the vault UI and writes. */
export function vaultConfigured(): boolean {
  return Boolean(process.env.FUNDEXECS_VAULT_KEY);
}

export interface EncryptedSecret {
  ciphertext: string; // base64
  iv: string; // base64
  authTag: string; // base64
}

/** Encrypt a plaintext secret for storage. Throws if the vault key is unset. */
export function encryptSecret(plaintext: string): EncryptedSecret {
  const key = deriveKey();
  if (!key) throw new Error("FUNDEXECS_VAULT_KEY is not configured");

  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const enc = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);

  return {
    ciphertext: enc.toString("base64"),
    iv: iv.toString("base64"),
    authTag: cipher.getAuthTag().toString("base64"),
  };
}

/**
 * Decrypt a stored secret. Throws if the vault key is unset or if the
 * ciphertext/tag fail authentication (tampering, wrong key, or corruption).
 */
export function decryptSecret({ ciphertext, iv, authTag }: EncryptedSecret): string {
  const key = deriveKey();
  if (!key) throw new Error("FUNDEXECS_VAULT_KEY is not configured");

  const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(iv, "base64"));
  decipher.setAuthTag(Buffer.from(authTag, "base64"));
  const dec = Buffer.concat([
    decipher.update(Buffer.from(ciphertext, "base64")),
    decipher.final(),
  ]);
  return dec.toString("utf8");
}
