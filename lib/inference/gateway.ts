// lib/inference/gateway.ts
// The inference gateway — the single chokepoint a capability request flows
// through. It routes (router.ts) over the available providers (registry.ts),
// executes on the chosen provider, and returns text + telemetry (provider,
// model, token usage, latency). A skill/step asks for a capability; the gateway
// resolves the model. On no available provider/model it returns a degraded
// result (never throws) so every caller keeps its deterministic fallback.

import { routableProviders, getInferenceProvider } from "./registry";
import { selectRoute } from "./router";
import type { InferenceRequest, InferenceResult, RoutePolicy } from "./types";

/** True when at least one provider can be called. */
export function inferenceConfigured(): boolean {
  return routableProviders().some((p) => p.available);
}

function degraded(error: string, latencyMs = 0): InferenceResult {
  return {
    ok: false,
    text: null,
    provider: null,
    model: null,
    usage: { inputTokens: 0, outputTokens: 0 },
    latencyMs,
    degraded: true,
    error,
  };
}

function policyFrom(req: InferenceRequest): RoutePolicy {
  return {
    capability: req.capability,
    sensitivity: req.sensitivity,
    region: req.region,
    contextTokens: req.contextTokens,
    preferTier: req.preferTier,
    costCeilingPer1kOutput: req.costCeilingPer1kOutput,
  };
}

/**
 * Run a capability request. Resolves a model (or the pinned `req.model`),
 * executes it, and returns the text plus telemetry. Never throws.
 */
export async function runInference(req: InferenceRequest): Promise<InferenceResult> {
  const providers = routableProviders();

  // Resolve provider + model — either a pinned model or capability routing.
  let providerKey: string;
  let modelId: string;

  if (req.model) {
    const owner = providers.find((p) => p.available && p.models.some((m) => m.id === req.model));
    if (!owner) return degraded(`No available provider serves pinned model ${req.model}`);
    providerKey = owner.key;
    modelId = req.model;
  } else {
    const route = selectRoute(policyFrom(req), providers);
    if (!route) return degraded("No available model satisfies the request policy");
    providerKey = route.provider;
    modelId = route.model.id;
  }

  const provider = getInferenceProvider(providerKey);
  if (!provider) return degraded(`Provider ${providerKey} not found`);

  const start = Date.now();
  try {
    const { text, usage } = await provider.complete(modelId, req);
    const latencyMs = Date.now() - start;
    return {
      ok: text != null,
      text,
      provider: providerKey,
      model: modelId,
      usage,
      latencyMs,
      degraded: text == null,
      error: text == null ? "provider returned no text" : undefined,
    };
  } catch (e) {
    return degraded(e instanceof Error ? e.message : "inference threw", Date.now() - start);
  }
}
