// lib/office/portraitGen.ts
// Premium "hero" portraits for Virtual Office characters, drawn by Claude as a
// self-contained SVG. The office UI never talks to the model directly — it goes
// through this small adapter so the concrete backend stays swappable, and so
// the model's raw output is always sanitized before it becomes a public asset.
//
// Why SVG (not a raster image API): Anthropic has no image-generation endpoint,
// but Claude is very capable at authoring vector illustration as SVG markup. We
// reuse the ANTHROPIC_API_KEY the app already configures for the copilot — no
// second provider secret — and get crisp, resolution-independent portraits.
//
// Server-only: reads a secret from the environment and calls the model. Never
// import this into a client component. The generated SVG is rendered by the app
// via <img src> (which neuters any script), and this module additionally strips
// scripts, event handlers, and external references as defense in depth.
import "server-only";
import type Anthropic from "@anthropic-ai/sdk";
import { anthropicClient, LONG_RUN_TIMEOUT_MS } from "@/lib/anthropic-client";

export interface GeneratedPortrait {
  /** A sanitized, self-contained SVG document (starts with `<svg`). */
  svg: string;
}

export interface PortraitGenerator {
  readonly id: string;
  readonly model: string;
  generate(prompt: string, signal?: AbortSignal): Promise<GeneratedPortrait>;
}

const SYSTEM = [
  "You are a master illustrator who outputs flat vector art as raw SVG.",
  "Return ONLY a single self-contained <svg> element — no markdown fences, no",
  "prose, no explanation before or after. Requirements:",
  "- Root <svg> with xmlns and viewBox=\"0 0 512 512\".",
  "- A friendly chibi-proportioned character bust (big rounded head, large",
  "  eyes), centered, framed from the chest up, filling most of the canvas.",
  "- Flat cel-shaded style: solid fills, a few soft highlight/shadow shapes, a",
  "  clean dark outline. Limited, warm, harmonious palette.",
  "- A simple flat background shape (no photo realism).",
  "- Use ONLY <path>, <rect>, <circle>, <ellipse>, <polygon>, <g>, and",
  "  <linearGradient>/<radialGradient> in <defs>. Reference gradients only via",
  '  fill="url(#id)". Do NOT use <image>, <use>, <a>, <text>, <foreignObject>,',
  "  <script>, href/xlink:href, external references, or event handlers.",
].join("\n");

/** Claude-backed portrait generator: prompts the model for a single SVG. */
class AnthropicPortraitGenerator implements PortraitGenerator {
  readonly id = "anthropic";
  constructor(
    private readonly apiKey: string,
    readonly model: string,
  ) {}

  async generate(prompt: string, signal?: AbortSignal): Promise<GeneratedPortrait> {
    const client = anthropicClient(this.apiKey, LONG_RUN_TIMEOUT_MS);
    const message = await client.messages.create(
      {
        model: this.model,
        max_tokens: 8000,
        system: SYSTEM,
        messages: [{ role: "user", content: prompt }],
      },
      signal ? { signal } : undefined,
    );

    const raw = message.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("\n");

    const svg = sanitizeSvg(raw);
    if (!svg) throw new Error("Model did not return a usable SVG.");
    return { svg };
  }
}

// Constructs that must never appear in a portrait we accept. We do NOT try to
// clean model output by stripping these — regex-based HTML filtering is
// notoriously bypassable (CodeQL's js/bad-tag-filter). Instead we REJECT the
// whole SVG if any is present and let the caller regenerate. The portrait is
// also only ever rendered through <img>/`data:` (see the action), which itself
// blocks scripting and external fetches; this validation is a second layer.
const FORBIDDEN: readonly RegExp[] = [
  /<\s*\/?\s*script/i, // scripting (open OR close tag, any whitespace)
  /<\s*foreignobject/i, // arbitrary embedded HTML
  /<\s*image/i, // raster/external image refs
  /<\s*use\b/i, // <use> can pull external refs
  /<\s*a\b/i, // hyperlinks / navigation
  /<\s*text\b/i, // we ask for shapes only, not text
  /<!\s*doctype/i, // DOCTYPE / entity tricks
  /<!\s*entity/i,
  /\son[a-z-]+\s*=/i, // any inline event handler (onload, onclick, …)
  /(?:xlink:)?href\s*=/i, // no external OR in-doc links; gradients use fill="url(#id)"
  /javascript:/i,
  /vbscript:/i,
  /data:/i, // no nested data: URIs
];

/**
 * Extract an SVG document from arbitrary model output and validate it against an
 * allowlist by REJECTION: returns the SVG string only when it is free of every
 * forbidden construct, otherwise null (no <svg> found, or something unsafe is
 * present). Guarantees an `xmlns`. Pure and total — safe to unit-test without a
 * network call. Intentionally does no partial cleaning: a portrait is either
 * entirely safe or regenerated.
 */
export function sanitizeSvg(raw: string): string | null {
  if (typeof raw !== "string") return null;
  // Drop a ```svg / ``` code fence if the model wrapped its answer in one. This
  // targets backticks only — it is not markup filtering.
  const fenced = raw.replace(/```(?:svg|xml|html)?/gi, "");
  const start = fenced.search(/<svg[\s>]/i);
  if (start === -1) return null;
  const end = fenced.lastIndexOf("</svg>");
  if (end === -1) return null;

  let svg = fenced.slice(start, end + "</svg>".length);

  // Reject rather than sanitize: any forbidden construct fails the whole SVG.
  for (const bad of FORBIDDEN) {
    if (bad.test(svg)) return null;
  }

  if (!/\sxmlns\s*=/.test(svg)) {
    svg = svg.replace(/^<svg/i, '<svg xmlns="http://www.w3.org/2000/svg"');
  }
  return svg;
}

/**
 * Resolve the active portrait generator from the environment, or null when the
 * app has no Anthropic key. Callers surface a "not configured" message rather
 * than throwing, so the feature degrades cleanly when the key is absent.
 */
export function resolvePortraitGenerator(): PortraitGenerator | null {
  const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
  if (!apiKey) return null;
  const model = process.env.OFFICE_PORTRAIT_MODEL?.trim() || "claude-sonnet-4-6";
  return new AnthropicPortraitGenerator(apiKey, model);
}

/** Whether AI portrait generation is available in this deployment. */
export function portraitGenerationConfigured(): boolean {
  return resolvePortraitGenerator() !== null;
}
