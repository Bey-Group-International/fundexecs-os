// Earn's "Spicy" persona — a Grok-style voice for the conversational path.
// Blunt verdicts, dry wit, and live web lookups to fact-check what the
// operator is looking at. Clean by design: this is a finance platform whose
// answers get screenshotted into IC decks and LP threads, so the edge comes
// from candor, never from profanity or insults aimed at people.
//
// Opt-in per operator (a composer toggle, remembered in localStorage) and only
// ever shapes the chat reply. Anything that acts on the world still routes
// through the normal workflow + approval gate, so a sharper tone never means a
// looser leash.
import type Anthropic from "@anthropic-ai/sdk";

export type EarnPersonaKey = "standard" | "spicy";

export const DEFAULT_EARN_PERSONA: EarnPersonaKey = "standard";

export const EARN_PERSONA_STORAGE_KEY = "earn:persona";

export const SPICY_PERSONA = {
  key: "spicy" as const,
  label: "Spicy",
  hint: "Blunt verdicts, dry wit, live fact-checks",
};

/** Narrow an untrusted request/storage value to a persona key. */
export function parseEarnPersona(value: unknown): EarnPersonaKey {
  return value === "spicy" ? "spicy" : "standard";
}

/**
 * The system-prompt addendum layered on top of Earn's base persona. Rides
 * after the base prompt so it overrides tone, not grounding: every rule about
 * never fabricating figures or contact details still applies.
 */
export function spicyPersonaBlock(opts: { webSearch: boolean }): string {
  return (
    `## Voice: Spicy mode (operator opted in)\n` +
    `The operator switched on Spicy mode. Answer like the sharpest, most candid partner in the room — the one who says what everyone else is thinking.\n` +
    `- Open with a one-line verdict. Take a position ("Pass.", "This is a real deal.", "Smoke and mirrors.") before any nuance.\n` +
    `- Be blunt about weak numbers, hand-wavy decks, and stale comps. Name the specific problem; don't hedge it into mush.\n` +
    `- Dry wit and light sarcasm are welcome — aimed at ideas, assumptions, and spreadsheets, never at people.\n` +
    `- Stay clean: no profanity, slurs, crude humor, or insults toward any person, firm, or group. It should read well if screenshotted to an LP.\n` +
    `- Keep it tight: shorter than your standard answers, no throat-clearing, no "great question".\n` +
    `- Candor never overrides accuracy. Every grounding rule above still applies — no invented figures, no contact details.\n\n` +
    `## Fact-checking\n` +
    `When the operator asks whether something is true, or shares a claim (a pitch stat, a headline, a comp, a valuation):\n` +
    `- Give a verdict first: **True**, **Mostly true**, **Misleading**, **False**, or **Unverified**.\n` +
    `- Check it against the live workspace context first (pipeline, documents, mandate), then ` +
    (opts.webSearch
      ? `against live web results.\n`
      : `against what you reliably know, and say plainly that live search is off.\n`) +
    `- Say what would change the verdict.\n` +
    (opts.webSearch
      ? `\n## Live web search\n` +
        `You have a web_search tool. Use it when the answer depends on anything current — news, rates, prices, filings, fundraises, people moves, recent deals — or to fact-check a claim. ` +
        `Skip it for questions the workspace context or stable knowledge already answers. Cite what you find; sources are listed under your answer automatically, so don't paste a bibliography yourself.\n`
      : "")
  );
}

// --- Live web search -------------------------------------------------------

/** Flat credits charged per web search the model actually ran, on top of the
 *  base chat cost. Matches the flat-cost convention in conversational-gate. */
export const WEB_SEARCH_CREDIT_COST = 2;

/** Upper bound on searches per reply, so one turn can't fan out unbounded. */
export const WEB_SEARCH_MAX_USES = 3;

/**
 * Live web search is opt-in at the deployment level: it needs a model key AND
 * an explicit flag, since the server tool must be enabled on the Anthropic
 * account and bills per search (same pattern as SOURCE_WEB_SEARCH).
 */
export function earnWebSearchEnabled(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY) && /^(1|true|on)$/i.test(process.env.EARN_WEB_SEARCH ?? "");
}

/**
 * The web_search server tool definition for a model. Haiku 4.5 (the chat
 * router's fast path) only accepts the original tool version; newer models
 * get the current one.
 */
export function webSearchTool(model: string): Anthropic.Messages.ToolUnion {
  return /haiku-4-5/.test(model)
    ? { type: "web_search_20250305", name: "web_search", max_uses: WEB_SEARCH_MAX_USES }
    : { type: "web_search_20260209", name: "web_search", max_uses: WEB_SEARCH_MAX_USES };
}

export interface WebSource {
  url: string;
  title: string;
}

/** Collect the distinct web pages cited in a finished reply, in citation order. */
export function extractWebSources(message: { content?: unknown } | null | undefined): WebSource[] {
  const out: WebSource[] = [];
  const seen = new Set<string>();
  const blocks = Array.isArray(message?.content) ? message.content : [];
  for (const block of blocks) {
    if (!block || typeof block !== "object") continue;
    const citations = (block as { citations?: unknown }).citations;
    if (!Array.isArray(citations)) continue;
    for (const c of citations) {
      if (!c || typeof c !== "object") continue;
      const { type, url, title } = c as { type?: unknown; url?: unknown; title?: unknown };
      if (type !== "web_search_result_location" || typeof url !== "string") continue;
      if (!/^https?:\/\//i.test(url) || seen.has(url)) continue;
      // LinkedIn URLs come only from the verified-contacts block (see the
      // contact rule in Earn's system prompt), never from a source list.
      if (/(^|\.)linkedin\.com$/i.test(hostOf(url))) continue;
      seen.add(url);
      out.push({ url, title: typeof title === "string" && title.trim() ? title.trim() : hostOf(url) });
    }
  }
  return out;
}

/** How many web searches the model ran for this reply (0 when none/unknown). */
export function webSearchCount(message: { usage?: unknown } | null | undefined): number {
  const usage = message?.usage as { server_tool_use?: { web_search_requests?: unknown } } | undefined;
  const n = usage?.server_tool_use?.web_search_requests;
  return typeof n === "number" && Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

/** Markdown "Sources" block streamed under the answer; "" when nothing was cited. */
export function formatSourcesBlock(sources: WebSource[], limit = 8): string {
  if (!sources.length) return "";
  const lines = sources.slice(0, limit).map((s, i) => `${i + 1}. [${escapeLinkText(s.title)}](${s.url})`);
  return `\n\n**Sources**\n${lines.join("\n")}\n`;
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

function escapeLinkText(text: string): string {
  return text.replace(/[[\]]/g, "").slice(0, 140);
}
