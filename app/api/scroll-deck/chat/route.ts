import { buildDeckProposal } from "@/lib/scroll-deck";
import { checkRateLimit, rateLimitHeaders } from "@/lib/rate-limit";
import type { DeckSection } from "@/components/scroll-deck/types";

// The deck section may be produced by a live model call — give it room beyond
// the default request window, mirroring /api/chat.
export const maxDuration = 60;

// POST /api/scroll-deck/chat — turns a fund manager's message into one deck
// section plus a reply. INTENTIONALLY UNGATED (no auth): it mirrors the
// standalone /scroll-deck page, which has no org session. IP-based rate
// limiting is the only guard against abuse of the model call.
export async function POST(request: Request) {
  const ip =
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "anonymous";
  const rateLimit = checkRateLimit({
    key: `scroll-deck:chat:${ip}`,
    limit: 30,
    windowMs: 60_000,
  });
  if (!rateLimit.ok) {
    return new Response(JSON.stringify({ error: "Rate limit exceeded" }), {
      status: 429,
      headers: {
        "Content-Type": "application/json",
        ...rateLimitHeaders(rateLimit, 30),
      },
    });
  }

  const body = await request.json().catch(() => ({}));
  const prompt = (body as { prompt?: unknown }).prompt;
  if (!prompt || typeof prompt !== "string") {
    return new Response(JSON.stringify({ error: "Missing 'prompt'" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const sections = Array.isArray((body as { sections?: unknown }).sections)
    ? ((body as { sections: DeckSection[] }).sections)
    : [];
  const rawStepIndex = (body as { stepIndex?: unknown }).stepIndex;
  const stepIndex =
    typeof rawStepIndex === "number" && Number.isFinite(rawStepIndex)
      ? rawStepIndex
      : sections.length;

  const proposal = await buildDeckProposal({ prompt, sections, stepIndex });

  return new Response(JSON.stringify(proposal), {
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
  });
}
