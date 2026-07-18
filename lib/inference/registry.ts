// lib/inference/registry.ts
// The inference provider registry — the pluggable seam (mirrors the skill and
// intelligence registries). Anthropic is the first live adapter; OpenAI / Google
// / local are added by implementing InferenceProvider + one line here. Nothing in
// FundExecs hard-codes a vendor above this seam.

import type { InferenceProvider, RoutableProvider } from "./types";
import { anthropicProvider } from "./anthropic";

const PROVIDERS: Record<string, InferenceProvider> = {
  [anthropicProvider.key]: anthropicProvider,
};

export function getInferenceProvider(key: string): InferenceProvider | null {
  return PROVIDERS[key] ?? null;
}

export function listInferenceProviders(): InferenceProvider[] {
  return Object.values(PROVIDERS);
}

/** Providers that can actually be called right now (creds present). */
export function availableInferenceProviders(): InferenceProvider[] {
  return listInferenceProviders().filter((p) => p.available());
}

/** The routable surface the pure router reasons over. */
export function routableProviders(): RoutableProvider[] {
  return listInferenceProviders().map((p) => ({
    key: p.key,
    available: p.available(),
    models: p.models(),
  }));
}
