// lib/integrations/active.ts
// The integrations the operator currently has active — surfaced in the
// composer's "+" menu so they can see what's connected and run its actions
// without leaving the page. "Active" now means connected for THIS org through
// the gateway (with the env-level default as a fallback); pass the resolved
// connected-channel set from the server. Capabilities come from the shared
// catalog, so the menu reflects exactly what the dispatch layer can route.
import { integrationCatalog, envConfiguredChannels } from "./catalog";
import type { IntegrationDescriptor, IntegrationCapability } from "./catalog";

export type { IntegrationCapability } from "./catalog";

// An active integration is just a catalog descriptor the org has connected.
export type ActiveIntegration = IntegrationDescriptor;

// The connected integrations, in catalog order. Defaults to the env-configured
// channels so existing callers (and tests) keep their deploy-wide behavior; the
// org-aware callers pass the gateway-resolved set.
export function getActiveIntegrations(
  connectedChannels: Iterable<string> = envConfiguredChannels(),
): ActiveIntegration[] {
  const connected = new Set(connectedChannels);
  return integrationCatalog().filter((d) => connected.has(d.channel));
}

export type { IntegrationDescriptor };
