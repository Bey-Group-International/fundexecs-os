// Server-side proof-of-pass for the public data room viewer.
//
// The gate (password / NDA / email) used to be enforced entirely in the
// browser: the page shipped every document, team email, and track-record
// figure in the initial payload regardless of gate config, and a client-side
// `gatePassed` boolean merely decided whether to blur it. Anyone could read
// the confidential content from view-source without ever passing the gate.
//
// This module makes "has this visitor passed the gate" a fact the SERVER can
// check before it decides what to send. A signed, HttpOnly cookie records
// which gates a visitor has satisfied for a specific share. It is only ever
// written by code that has independently verified the corresponding gate:
//   - `pwd`   — set after a real password comparison succeeds.
//   - `nda`   — set after an NDA signature row is actually inserted.
//   - `email` — set after a syntactically valid email is captured (this gate
//               has no secret to check; it exists to require the data, not to
//               authenticate it).
// Nothing here trusts a client-supplied "I already did this" claim.
import { createHmac, timingSafeEqual } from "crypto";

const COOKIE_PREFIX = "fx_dr_gate_";
// Long enough that a returning LP isn't re-gated on every visit; short enough
// to bound the blast radius of a leaked cookie value.
const PASS_TTL_MS = 1000 * 60 * 60 * 24 * 14;

export interface GatePassPayload {
  shareId: string;
  pwd: boolean;
  nda: boolean;
  email: string | null;
  iat: number;
}

export interface GateRequirements {
  require_email: boolean;
  require_nda: boolean;
  password_hash: string | null;
}

function gateSecret(): string {
  // Derived from the service-role key so no new secret needs provisioning —
  // the data room is already fully gated behind `hasSupabaseServiceEnv()`, so
  // this key is always present wherever the data room itself works.
  const base = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  return createHmac("sha256", "fx-data-room-gate").update(base).digest("hex");
}

function sign(payload: GatePassPayload): string {
  const body = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const mac = createHmac("sha256", gateSecret()).update(body).digest("base64url");
  return `${body}.${mac}`;
}

function verify(value: string): GatePassPayload | null {
  const dot = value.lastIndexOf(".");
  if (dot < 0) return null;
  const body = value.slice(0, dot);
  const mac = value.slice(dot + 1);
  const expectedMac = createHmac("sha256", gateSecret()).update(body).digest("base64url");
  const a = Buffer.from(mac);
  const b = Buffer.from(expectedMac);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as GatePassPayload;
    if (typeof payload.shareId !== "string" || typeof payload.iat !== "number") return null;
    if (Date.now() - payload.iat > PASS_TTL_MS) return null;
    return payload;
  } catch {
    return null;
  }
}

function cookieName(shareId: string): string {
  return `${COOKIE_PREFIX}${shareId}`;
}

/** Read and verify the caller's gate pass for a specific share. Read-only —
 * safe to call from a Server Component (page render), Route Handler, or
 * Server Action. Returns null if absent, tampered, expired, or mismatched. */
export async function readGatePass(shareId: string): Promise<GatePassPayload | null> {
  const { cookies } = await import("next/headers");
  const store = await cookies();
  const raw = store.get(cookieName(shareId))?.value;
  if (!raw) return null;
  const payload = verify(raw);
  if (!payload || payload.shareId !== shareId) return null;
  return payload;
}

/** Record that ONE gate has been independently verified, merging it into any
 * existing pass for this share and re-signing. Callers must only invoke this
 * after doing the actual verification (password compare, NDA insert, email
 * format check) — this function itself does no verification. Cookie writes
 * are only legal from a Server Action or Route Handler, never a Server
 * Component render. */
export async function grantGate(
  shareId: string,
  patch: Partial<Pick<GatePassPayload, "pwd" | "nda" | "email">>,
): Promise<void> {
  const { cookies } = await import("next/headers");
  const store = await cookies();
  const existing = await readGatePass(shareId);
  const payload: GatePassPayload = {
    shareId,
    pwd: existing?.pwd ?? false,
    nda: existing?.nda ?? false,
    email: existing?.email ?? null,
    ...patch,
    iat: Date.now(), // refresh TTL on every successful step
  };
  store.set(cookieName(shareId), sign(payload), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: Math.floor(PASS_TTL_MS / 1000),
  });
}

/** Whether every gate the share currently requires has been satisfied by the
 * given pass. A null pass satisfies only a share with no requirements. */
export function gateSatisfied(share: GateRequirements, pass: GatePassPayload | null): boolean {
  if (share.require_email && !pass?.email) return false;
  if (share.require_nda && !pass?.nda) return false;
  if (share.password_hash && !pass?.pwd) return false;
  return true;
}
