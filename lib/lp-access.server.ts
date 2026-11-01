// lib/lp-access.server.ts
//
// Who may act on an LP onboarding link.
//
// The link's token only says WHICH onboarding this is. Anyone holding the link
// could otherwise complete it, so the LP also proves they received the code sent
// to the email the fund manager entered (or one the fund manager read to them).
// Passing that check writes a signed, HttpOnly cookie bound to that one session;
// every wizard action requires it.
//
// Codes are 6 digits, stored only as an HMAC, valid for 15 minutes, and locked
// after 5 wrong tries. A new code retires the old ones. Issuing is rate limited
// so the link cannot be used to flood an inbox.
import "server-only";
import { createHmac, randomInt, timingSafeEqual } from "crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import {
  CODE_MAX_ATTEMPTS,
  CODE_TTL_MS,
  canIssueCode,
  generateCode,
  normalizeCode,
} from "@/lib/lp-wizard";

type Client = SupabaseClient<Database>;

/**
 * Keyed from LP_ACCESS_SECRET when set. Falls back to the service-role key so
 * nothing breaks before it is provisioned. A dedicated secret matters because
 * rotating the service-role key would otherwise silently invalidate every open
 * code and pass, and anyone holding that key could forge a pass. Switching the
 * key (either direction) invalidates codes (15 min) and passes (6 h) in flight.
 */
function secret(label: string): string {
  const key = process.env.LP_ACCESS_SECRET?.trim() || process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  return createHmac("sha256", label).update(key).digest("hex");
}

export function hashCode(sessionId: string, code: string): string {
  return createHmac("sha256", secret("fx-lp-code")).update(`${sessionId}:${code}`).digest("hex");
}

function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export interface LinkSession {
  id: string;
  organization_id: string;
  lp_name: string;
  lp_email: string;
  status: string;
  review_state: string;
  lp_type: string;
  owner_threshold_pct: number;
  expires_at: string;
}

/** A session reached by its link token, if the link is still usable. No proof of the LP yet. */
export async function getLinkSession(supabase: Client, token: string): Promise<LinkSession | null> {
  if (typeof token !== "string" || token.length < 16 || token.length > 200) return null;
  const { data } = await supabase
    .from("lp_onboarding_sessions")
    .select("id, organization_id, lp_name, lp_email, status, review_state, lp_type, owner_threshold_pct, expires_at")
    .eq("token", token)
    .maybeSingle();
  if (!data) return null;
  const row = data as unknown as LinkSession;
  if (new Date(row.expires_at).getTime() < Date.now()) return null;
  if (row.status === "expired") return null;
  return row;
}

export type IssueResult =
  | { ok: true; code: string; expiresAt: string }
  | { ok: false; error: string };

/** Mints a code, retiring any still open. `createdBy` is the fund manager who asked for it, if any. */
export async function issueCode(
  supabase: Client,
  session: Pick<LinkSession, "id" | "organization_id">,
  kind: "email" | "gp",
  createdBy: string | null,
  now: number = Date.now(),
): Promise<IssueResult> {
  const { data: recent } = await supabase
    .from("lp_link_codes")
    .select("created_at")
    .eq("session_id", session.id)
    .order("created_at", { ascending: false })
    .limit(20);
  const gate = canIssueCode(((recent ?? []) as { created_at: string }[]).map((r) => r.created_at), now);
  if (!gate.ok) return gate;

  // Retire what is still open so only the newest code works.
  await supabase
    .from("lp_link_codes")
    .update({ consumed_at: new Date(now).toISOString() } as never)
    .eq("session_id", session.id)
    .is("consumed_at", null);

  const code = generateCode(randomInt);
  const expiresAt = new Date(now + CODE_TTL_MS).toISOString();
  const { error } = await supabase.from("lp_link_codes").insert({
    organization_id: session.organization_id,
    session_id: session.id,
    code_hash: hashCode(session.id, code),
    kind,
    expires_at: expiresAt,
    created_by: createdBy,
  } as never);
  if (error) {
    console.error("lp-access issueCode failed", { code: error.code, message: error.message });
    return { ok: false, error: "Couldn't create a code. Try again." };
  }
  return { ok: true, code, expiresAt };
}

/** Why a code was refused, for the audit trail. Never shown to the LP, who gets `error`. */
export type VerifyFailure = "format" | "expired" | "locked" | "wrong" | "used";
export type VerifyResult = { ok: true } | { ok: false; error: string; reason: VerifyFailure };

/** Checks a typed code. A wrong guess spends one of five tries; the right one is used up. */
export async function verifyCode(
  supabase: Client,
  session: Pick<LinkSession, "id">,
  input: unknown,
  now: number = Date.now(),
): Promise<VerifyResult> {
  const code = normalizeCode(input);
  if (!code) return { ok: false, error: "Enter the 6-digit code.", reason: "format" };

  const { data } = await supabase
    .from("lp_link_codes")
    .select("id, code_hash, expires_at, attempts")
    .eq("session_id", session.id)
    .is("consumed_at", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const row = data as { id: string; code_hash: string; expires_at: string; attempts: number } | null;
  if (!row || new Date(row.expires_at).getTime() < now) {
    return { ok: false, error: "That code has expired. Ask for a new one.", reason: "expired" };
  }
  if (row.attempts >= CODE_MAX_ATTEMPTS) {
    return { ok: false, error: "Too many wrong codes. Ask for a new one.", reason: "locked" };
  }

  if (!safeEqual(hashCode(session.id, code), row.code_hash)) {
    // Spend the try only if nobody else spent it first, so parallel guesses cannot beat the limit.
    await supabase
      .from("lp_link_codes")
      .update({ attempts: row.attempts + 1 } as never)
      .eq("id", row.id)
      .eq("attempts", row.attempts);
    return { ok: false, error: "That code isn't right.", reason: "wrong" };
  }

  // Use it up, but only once: a parallel request with the same code loses.
  const { data: used } = await supabase
    .from("lp_link_codes")
    .update({ consumed_at: new Date(now).toISOString() } as never)
    .eq("id", row.id)
    .is("consumed_at", null)
    .select("id");
  if (!used || used.length === 0) return { ok: false, error: "That code has already been used. Ask for a new one.", reason: "used" };
  return { ok: true };
}

// ---- the LP's pass ---------------------------------------------------------

const PASS_PREFIX = "fx_lp_";
/** Long enough to finish the wizard in a sitting or two, short enough to bound a leaked cookie. */
const PASS_TTL_MS = 1000 * 60 * 60 * 6;

interface PassPayload {
  sid: string;
  iat: number;
}

function signPass(p: PassPayload): string {
  const body = Buffer.from(JSON.stringify(p), "utf8").toString("base64url");
  const mac = createHmac("sha256", secret("fx-lp-pass")).update(body).digest("base64url");
  return `${body}.${mac}`;
}

function readPassValue(value: string, now: number): PassPayload | null {
  const dot = value.lastIndexOf(".");
  if (dot < 0) return null;
  const body = value.slice(0, dot);
  const mac = createHmac("sha256", secret("fx-lp-pass")).update(body).digest("base64url");
  if (!safeEqual(value.slice(dot + 1), mac)) return null;
  try {
    const p = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as PassPayload;
    if (typeof p.sid !== "string" || typeof p.iat !== "number") return null;
    if (now - p.iat > PASS_TTL_MS) return null;
    return p;
  } catch {
    return null;
  }
}

/** Whether this browser has passed the code check for this session. Safe in a page render. */
export async function hasLpPass(sessionId: string, now: number = Date.now()): Promise<boolean> {
  const { cookies } = await import("next/headers");
  const raw = (await cookies()).get(`${PASS_PREFIX}${sessionId}`)?.value;
  if (!raw) return false;
  return readPassValue(raw, now)?.sid === sessionId;
}

/** Only call after verifyCode succeeded. Cookie writes are legal only in a server action or route handler. */
export async function grantLpPass(sessionId: string, now: number = Date.now()): Promise<void> {
  const { cookies } = await import("next/headers");
  (await cookies()).set(`${PASS_PREFIX}${sessionId}`, signPass({ sid: sessionId, iat: now }), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: Math.floor(PASS_TTL_MS / 1000),
  });
}
