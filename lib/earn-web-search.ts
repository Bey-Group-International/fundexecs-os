// Live web search for Earn's conversational path: Claude's web_search server
// tool, the cited-sources block streamed under an answer, and per-search
// credit metering. Deployment-gated (EARN_WEB_SEARCH) and opt-in per call —
// a caller passes `webSearch` to earnChatStream only where fresh, cited
// information earns its cost.
import type Anthropic from "@anthropic-ai/sdk";

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
export function webSearchTool(model: string, maxUses = WEB_SEARCH_MAX_USES): Anthropic.Messages.ToolUnion {
  return /haiku-4-5/.test(model)
    ? { type: "web_search_20250305", name: "web_search", max_uses: maxUses }
    : { type: "web_search_20260209", name: "web_search", max_uses: maxUses };
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
