import { NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";
import { brainForAvatar } from "@/lib/brains/avatars";
import { getBrain } from "@/lib/brains/catalog";
import { complete, brainsLive } from "@/lib/brains/llm";
import { checkRateLimit, clientIp } from "@/lib/rate-limit";

// POST /api/avatars/introspect — the LIVING-EXECS M3 "attachBrain" slow loop.
//
// Given an office avatar (roster id or sprite key) and its current fast-loop
// state, ask the avatar's Brain persona for ONE understated, first-person,
// present-tense sentence describing what it is doing right now. The office uses
// this to enrich its local `say` line; if anything is unavailable it silently
// keeps that local line.
//
// GRACEFUL by design: no resolvable brain, no API key/model, a model error, or
// an invalid body all return 200 { say: null } (never 4xx/5xx) so the office
// falls back cleanly. The ONE exception is auth: unauthenticated callers get
// 401. Auth mirrors app/api/brains/ingest — a shared Bearer secret OR an
// authenticated org member.
//
// Force dynamic so the auth read + model call never run at build time.
export const dynamic = "force-dynamic";

// Keep this comfortably above the fast-loop cadence but low enough to bound
// spend if the office ever loops the endpoint. Exceeding it degrades to
// { say: null } (silent office fallback), not a 429 — the office contract is
// "200 with say or null".
const RATE_LIMIT = 60;
const RATE_WINDOW_MS = 60_000;

// One short sentence; keep tokens tiny (the output is clamped to ≤ 16 words).
const MAX_TOKENS = 48;
const MAX_WORDS = 16;

interface IntrospectBody {
  avatar: string;
  behavior: string;
  goal?: string;
  mood?: string;
  zone?: string;
  nearby?: string[];
}

async function isAuthorized(request: Request): Promise<boolean> {
  // 1) Shared-secret path (scripted/office server), mirrors brains/ingest.
  const secret = process.env.BRAIN_INGEST_SECRET;
  if (secret && request.headers.get("authorization") === `Bearer ${secret}`) {
    return true;
  }
  // 2) Authenticated-org-member path.
  try {
    const supabase = await createServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return false;
    const { data, error } = await supabase
      .from("organization_members")
      .select("organization_id")
      .in("role", ["owner", "admin", "member"])
      .limit(1);
    return !error && Boolean(data && data.length > 0);
  } catch {
    return false;
  }
}

/** Validate + narrow the request body without throwing. */
function parseBody(raw: unknown): IntrospectBody | null {
  if (!raw || typeof raw !== "object") return null;
  const b = raw as Record<string, unknown>;
  if (typeof b.avatar !== "string" || b.avatar.trim() === "") return null;
  if (typeof b.behavior !== "string" || b.behavior.trim() === "") return null;
  const nearby = Array.isArray(b.nearby)
    ? b.nearby.filter((n): n is string => typeof n === "string")
    : undefined;
  return {
    avatar: b.avatar,
    behavior: b.behavior,
    goal: typeof b.goal === "string" ? b.goal : undefined,
    mood: typeof b.mood === "string" ? b.mood : undefined,
    zone: typeof b.zone === "string" ? b.zone : undefined,
    nearby,
  };
}

/** Trim, strip wrapping quotes, take the first sentence, clamp to ≤ 16 words. */
function clampSay(text: string): string | null {
  let s = text.trim().replace(/^["'“”]+|["'“”]+$/g, "").trim();
  if (!s) return null;
  // First sentence only.
  const firstStop = s.search(/[.!?]/);
  if (firstStop !== -1) s = s.slice(0, firstStop + 1);
  const words = s.split(/\s+/).filter(Boolean);
  if (words.length > MAX_WORDS) {
    s = words.slice(0, MAX_WORDS).join(" ");
  }
  s = s.trim();
  if (!s) return null;
  if (!/[.!?]$/.test(s)) s += ".";
  return s;
}

function buildPrompts(
  brain: NonNullable<ReturnType<typeof getBrain>>,
  body: IntrospectBody,
): { system: string; prompt: string } {
  const system = [
    brain.systemPreamble,
    `You are ${brain.name} — ${brain.role} Reasoning style: ${brain.reasoningStyle}`,
    `Reply with EXACTLY ONE first-person, present-tense sentence of at most ${MAX_WORDS} words describing what you are doing right now. Understated, institutional tone. No quotes, no preamble, no lists.`,
  ].join("\n\n");

  const state: string[] = [`Current activity: ${body.behavior}.`];
  if (body.goal) state.push(`Active goal: ${body.goal}.`);
  if (body.mood) state.push(`Mood: ${body.mood}.`);
  if (body.zone) state.push(`Location: ${body.zone}.`);
  if (body.nearby && body.nearby.length) state.push(`Nearby colleagues: ${body.nearby.join(", ")}.`);
  state.push("In one short first-person, present-tense sentence, say what you are doing right now.");

  return { system, prompt: state.join("\n") };
}

const NULL_SAY = { say: null as string | null };

export async function POST(request: Request) {
  if (!(await isAuthorized(request))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Lightweight per-request guard. Over the limit → silent fallback, not 429.
  const rl = checkRateLimit({
    key: `avatars:introspect:${clientIp(request)}`,
    limit: RATE_LIMIT,
    windowMs: RATE_WINDOW_MS,
  });
  if (!rl.ok) return NextResponse.json(NULL_SAY);

  // Invalid body → graceful null.
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json(NULL_SAY);
  }
  const body = parseBody(raw);
  if (!body) return NextResponse.json(NULL_SAY);

  // Resolve the persona's Brain. Unknown avatar / no dedicated Brain → null.
  const brainKey = brainForAvatar(body.avatar);
  if (!brainKey) return NextResponse.json(NULL_SAY);
  const brain = getBrain(brainKey);
  if (!brain) return NextResponse.json(NULL_SAY);

  // No API key / model configured → null (office keeps its local line).
  if (!brainsLive()) return NextResponse.json(NULL_SAY);

  const { system, prompt } = buildPrompts(brain, body);

  // complete() uses the fast, inexpensive default model (Haiku) and returns null
  // on any error or missing key — never throws.
  const text = await complete({ system, prompt, maxTokens: MAX_TOKENS });
  const say = text ? clampSay(text) : null;
  return NextResponse.json({ say });
}
