// lib/office/imagegen.ts
// Provider-agnostic image generation for Character Studio AI portraits. The
// office UI never talks to a provider directly — it goes through this small
// adapter surface so the concrete backend (OpenAI today; a specialized sprite
// model later) can be swapped without touching callers.
//
// Server-only: reads a secret from the environment and makes an outbound HTTPS
// call. Never import this into a client component.
import "server-only";

export interface GeneratedImage {
  /** Base64-encoded image bytes (no data-URI prefix). */
  base64: string;
  mime: string;
}

export interface ImageGenerateOptions {
  /** Square size string the provider understands, e.g. "1024x1024". */
  size?: string;
  /** "transparent" | "opaque" | "auto" — providers that support it use this. */
  background?: string;
  /** Abort/timeout signal. */
  signal?: AbortSignal;
}

export interface ImageGenerator {
  readonly id: string;
  readonly model: string;
  generate(prompt: string, opts?: ImageGenerateOptions): Promise<GeneratedImage>;
}

/** OpenAI Images adapter (gpt-image-1 by default). Uses fetch — no SDK dep. */
class OpenAIImageGenerator implements ImageGenerator {
  readonly id = "openai";
  constructor(
    private readonly apiKey: string,
    readonly model: string,
  ) {}

  async generate(prompt: string, opts: ImageGenerateOptions = {}): Promise<GeneratedImage> {
    const body: Record<string, unknown> = {
      model: this.model,
      prompt,
      n: 1,
      size: opts.size ?? "1024x1024",
    };
    // gpt-image-1 supports transparent backgrounds and always returns b64.
    if (this.model.startsWith("gpt-image")) {
      body.background = opts.background ?? "transparent";
    } else {
      body.response_format = "b64_json"; // dall-e-3 etc.
    }

    const res = await fetch("https://api.openai.com/v1/images/generations", {
      method: "POST",
      headers: { authorization: `Bearer ${this.apiKey}`, "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: opts.signal,
    });

    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new Error(`Image generation failed (${res.status}). ${detail}`.trim().slice(0, 400));
    }
    const data = (await res.json()) as { data?: { b64_json?: string }[] };
    const b64 = data?.data?.[0]?.b64_json;
    if (!b64) throw new Error("Image generation returned no image.");
    return { base64: b64, mime: "image/png" };
  }
}

/**
 * Resolve the active image generator from the environment, or null when none is
 * configured. Callers surface a "not configured" message to the user rather
 * than throwing, so the feature degrades cleanly when the key is absent.
 */
export function resolveImageGenerator(): ImageGenerator | null {
  const openaiKey = process.env.OPENAI_API_KEY?.trim();
  if (openaiKey) {
    const model = process.env.OFFICE_PORTRAIT_MODEL?.trim() || "gpt-image-1";
    return new OpenAIImageGenerator(openaiKey, model);
  }
  return null;
}

/** Whether AI portrait generation is available in this deployment. */
export function imageGenerationConfigured(): boolean {
  return resolveImageGenerator() !== null;
}
