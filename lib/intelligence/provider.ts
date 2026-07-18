// lib/intelligence/provider.ts
// The native intelligence provider registry — the pluggable seam (mirrors
// lib/proactive/pmi/registry.ts). A new source is added by implementing the
// IntelligenceProvider interface and registering it here: config, not plumbing.
//
// Signal Bureau is the first connector, and it is OPTIONAL — the registry (and
// the whole intelligence core) works with zero providers, on manual entry
// alone. A provider is only ever consulted when its feature flag is on AND the
// workspace has a connected ProviderConnection row.

import type { IntelligenceProvider } from "./types";
import { signalBureauProvider } from "./providers/signal-bureau";

const PROVIDERS: Record<string, IntelligenceProvider> = {
  [signalBureauProvider.key]: signalBureauProvider,
};

export function getIntelligenceProvider(key: string): IntelligenceProvider | null {
  return PROVIDERS[key] ?? null;
}

export function listIntelligenceProviders(): IntelligenceProvider[] {
  return Object.values(PROVIDERS);
}
