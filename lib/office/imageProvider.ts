// Provider-agnostic text-to-image generation for premium AI portraits.
//
// SERVER-ONLY. The default target is Replicate, gated entirely by environment:
// with no `REPLICATE_API_TOKEN` set, `getImageProvider()` returns null and the
// caller degrades to a procedural fallback. Nothing here ever throws — every
// failure path (missing key, HTTP error, timeout, unsafe prompt, bad output)
// resolves to `null` so the portrait pipeline can signal "fallback" cleanly.

// The interface is intentionally tiny so swapping in another provider (or a
// local model) is a matter of implementing `generate`.
export interface ImageProvider {
  name: string;
  /** Render a prompt to PNG/JPEG bytes, or null on any failure. Never throws. */
  generate(prompt: string): Promise<Uint8Array | null>;
}

// A fast, inexpensive, well-known text-to-image default. Override per-deploy
// with REPLICATE_IMAGE_MODEL — either "owner/name" (latest version, resolved
// through the model-scoped endpoint) or "owner/name:versionHash".
const DEFAULT_REPLICATE_MODEL = "black-forest-labs/flux-schnell";

// Bound the total time we'll wait on a prediction so a hung job can't stall a
// server action. Polls at a fixed cadence up to this ceiling.
const MAX_WAIT_MS = 60_000;
const POLL_INTERVAL_MS = 1_500;

// Lightweight prompt guard — a defense-in-depth check before we spend a
// generation. The portrait prompts are built from a closed catalog, so this is
// belt-and-suspenders against a future free-text path.
const BANNED_TERMS = [
  "nsfw",
  "nude",
  "naked",
  "porn",
  "sexual",
  "explicit",
  "gore",
  "violence",
  "weapon",
];

export function isPromptSafe(prompt: string): boolean {
  if (!prompt || typeof prompt !== "string") return false;
  const trimmed = prompt.trim();
  if (trimmed.length < 8 || trimmed.length > 2_000) return false;
  const lower = trimmed.toLowerCase();
  return !BANNED_TERMS.some((term) => lower.includes(term));
}

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

interface ReplicatePrediction {
  status?: string;
  output?: unknown;
  urls?: { get?: string };
  error?: unknown;
}

/** Pull the first image URL out of Replicate's (string | string[]) output. */
function firstOutputUrl(output: unknown): string | null {
  if (typeof output === "string") return output;
  if (Array.isArray(output)) {
    const first = output.find((v) => typeof v === "string");
    return typeof first === "string" ? first : null;
  }
  return null;
}

function replicateProvider(token: string, model: string): ImageProvider {
  return {
    name: "replicate",
    async generate(prompt: string): Promise<Uint8Array | null> {
      if (!isPromptSafe(prompt)) return null;

      const authHeaders = {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      };

      try {
        // A version hash (model contains ":") posts to /v1/predictions with a
        // `version`; a bare "owner/name" uses the model-scoped endpoint, which
        // resolves the latest version server-side without a hardcoded hash.
        const [ref, version] = model.split(":");
        const createUrl = version
          ? "https://api.replicate.com/v1/predictions"
          : `https://api.replicate.com/v1/models/${ref}/predictions`;
        const body = version
          ? { version, input: { prompt } }
          : { input: { prompt } };

        const createRes = await fetch(createUrl, {
          method: "POST",
          headers: authHeaders,
          body: JSON.stringify(body),
        });
        if (!createRes.ok) return null;

        const created = (await createRes.json()) as ReplicatePrediction;
        const pollUrl = created.urls?.get;
        let prediction = created;

        // Poll until terminal or the wait ceiling is reached.
        const deadline = Date.now() + MAX_WAIT_MS;
        while (
          prediction.status !== "succeeded" &&
          prediction.status !== "failed" &&
          prediction.status !== "canceled"
        ) {
          if (Date.now() > deadline || !pollUrl) return null;
          await sleep(POLL_INTERVAL_MS);
          const pollRes = await fetch(pollUrl, { headers: authHeaders });
          if (!pollRes.ok) return null;
          prediction = (await pollRes.json()) as ReplicatePrediction;
        }

        if (prediction.status !== "succeeded") return null;

        const imageUrl = firstOutputUrl(prediction.output);
        if (!imageUrl) return null;

        const imgRes = await fetch(imageUrl);
        if (!imgRes.ok) return null;
        const buf = await imgRes.arrayBuffer();
        const bytes = new Uint8Array(buf);
        return bytes.byteLength > 0 ? bytes : null;
      } catch {
        return null;
      }
    },
  };
}

/**
 * Resolve the configured image provider, or null when none is configured.
 * Currently returns a Replicate-backed provider when `REPLICATE_API_TOKEN` is
 * set (model from `REPLICATE_IMAGE_MODEL`, defaulting to flux-schnell); returns
 * null otherwise so callers degrade to the procedural fallback.
 */
export function getImageProvider(): ImageProvider | null {
  const token = process.env.REPLICATE_API_TOKEN?.trim();
  if (!token) return null;
  const model = process.env.REPLICATE_IMAGE_MODEL?.trim() || DEFAULT_REPLICATE_MODEL;
  return replicateProvider(token, model);
}
