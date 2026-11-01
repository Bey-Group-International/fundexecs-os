// Application-level field encryption (AES-256-GCM) for sensitive columns.
//
// Why app-level, not just "encryption at rest": the database and storage are
// already encrypted at rest by the vendor, which protects a stolen disk but not
// a leaked service-role key, a SQL injection, an over-broad RLS policy or a
// careless export. A value encrypted here is ciphertext to all of those; only
// code holding FIELD_ENCRYPTION_KEYS can read it.
//
// Format:  fx1.<keyId>.<iv>.<ciphertext>.<tag>   (each part base64url)
//
//  - keyId names the key used, so keys can be rotated: new writes use the
//    ACTIVE key (first listed), old values still decrypt with any listed key.
//  - A fresh random 96-bit IV per value.
//  - AAD ("additional authenticated data") binds a value to where it lives
//    (table.column + row id). Copying one row's ciphertext into another row, or
//    another column, then fails authentication instead of decrypting.
//
// Config (server-only environment):
//   FIELD_ENCRYPTION_KEYS      "k1:<base64 of 32 bytes>[,k0:<...>]"  first = active
//   FIELD_ENCRYPTION_REQUIRED  "on" => refuse to write plaintext when no key is set
//
// With no key configured and REQUIRED unset, writes stay plaintext (and warn
// once), so the code can ship before the key is provisioned. Turn REQUIRED on
// once it is. Generate a key:  openssl rand -base64 32
import { createCipheriv, createDecipheriv, randomBytes } from "crypto";

export const ENCRYPTED_PREFIX = "fx1.";
const KEY_ID = /^[A-Za-z0-9_-]{1,16}$/;

type Env = Record<string, string | undefined>;

export class FieldEncryptionConfigError extends Error {}
export class FieldDecryptionError extends Error {
  constructor(public readonly reason: "malformed" | "unknown_key" | "auth_failed") {
    super(`Could not decrypt field (${reason})`);
  }
}

interface KeyRing {
  active: { id: string; key: Buffer };
  all: Map<string, Buffer>;
}

function parseKeys(raw: string | undefined): KeyRing | null {
  const text = raw?.trim();
  if (!text) return null;
  const all = new Map<string, Buffer>();
  let active: KeyRing["active"] | null = null;
  for (const entry of text.split(",")) {
    const sep = entry.indexOf(":");
    const id = entry.slice(0, sep).trim();
    const b64 = entry.slice(sep + 1).trim();
    if (sep < 1 || !KEY_ID.test(id)) throw new FieldEncryptionConfigError("FIELD_ENCRYPTION_KEYS: each entry must be <id>:<base64 key>");
    const key = Buffer.from(b64, "base64");
    if (key.length !== 32) throw new FieldEncryptionConfigError(`FIELD_ENCRYPTION_KEYS: key "${id}" must be 32 bytes`);
    if (all.has(id)) throw new FieldEncryptionConfigError(`FIELD_ENCRYPTION_KEYS: duplicate key id "${id}"`);
    all.set(id, key);
    active ??= { id, key };
  }
  return active ? { active, all } : null;
}

export function fieldEncryptionConfigured(env: Env = process.env): boolean {
  return parseKeys(env.FIELD_ENCRYPTION_KEYS) !== null;
}

export function isEncrypted(value: unknown): value is string {
  return typeof value === "string" && value.startsWith(ENCRYPTED_PREFIX);
}

let warned = false;

/** Encrypt `plain`, bound to `aad`. null/empty pass through (nothing to protect). */
export function encryptField(plain: string | null | undefined, aad: string, env: Env = process.env): string | null {
  if (plain == null || plain === "") return plain ?? null;
  const ring = parseKeys(env.FIELD_ENCRYPTION_KEYS);
  if (!ring) {
    if (env.FIELD_ENCRYPTION_REQUIRED?.trim().toLowerCase() === "on") {
      throw new FieldEncryptionConfigError("FIELD_ENCRYPTION_REQUIRED is on but FIELD_ENCRYPTION_KEYS is not set");
    }
    if (!warned) {
      warned = true;
      console.warn("FIELD_ENCRYPTION_KEYS is not set: sensitive fields are being stored unencrypted");
    }
    return plain;
  }
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", ring.active.key, iv);
  cipher.setAAD(Buffer.from(aad, "utf8"));
  const ct = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [ENCRYPTED_PREFIX.slice(0, -1), ring.active.id, iv, ct, tag]
    .map((p) => (typeof p === "string" ? p : p.toString("base64url")))
    .join(".");
}

/**
 * Decrypt a stored value. A value without the prefix is legacy plaintext (from
 * before encryption was on) and is returned unchanged, so rows can be migrated
 * lazily. Throws FieldDecryptionError for a prefixed value that cannot be read.
 */
export function decryptField(value: string | null | undefined, aad: string, env: Env = process.env): string | null {
  if (value == null) return null;
  if (!isEncrypted(value)) return value;
  const parts = value.split(".");
  if (parts.length !== 5) throw new FieldDecryptionError("malformed");
  const [, keyId, ivB64, ctB64, tagB64] = parts;
  const ring = parseKeys(env.FIELD_ENCRYPTION_KEYS);
  const key = ring?.all.get(keyId);
  if (!key) throw new FieldDecryptionError("unknown_key");
  try {
    const iv = Buffer.from(ivB64, "base64url");
    const tag = Buffer.from(tagB64, "base64url");
    if (iv.length !== 12 || tag.length !== 16) throw new FieldDecryptionError("malformed");
    const decipher = createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAAD(Buffer.from(aad, "utf8"));
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(Buffer.from(ctB64, "base64url")), decipher.final()]).toString("utf8");
  } catch (err) {
    if (err instanceof FieldDecryptionError) throw err;
    throw new FieldDecryptionError("auth_failed");
  }
}

/** Like decryptField but returns null (and logs the reason, never the value) instead of throwing. */
export function decryptFieldSafe(value: string | null | undefined, aad: string, env: Env = process.env): string | null {
  try {
    return decryptField(value, aad, env);
  } catch (err) {
    console.error("field decrypt failed", { aad, reason: err instanceof FieldDecryptionError ? err.reason : "unknown" });
    return null;
  }
}
