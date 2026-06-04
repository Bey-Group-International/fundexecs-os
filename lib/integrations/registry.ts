import type { Provider } from './types';
import { googleCalendarProvider } from './providers/google-calendar';
import { gmailProvider } from './providers/gmail';

/**
 * Providers wired for ingestion today. Both Google providers use the Google
 * `provider_token` from the user's Supabase session. Add Calendly, Slack,
 * Apollo, Outlook adapters here as their OAuth is configured.
 */
export const providers: Record<string, Provider> = {
  [googleCalendarProvider.id]: googleCalendarProvider,
  [gmailProvider.id]: gmailProvider
};

/** Providers that authenticate via the Google session provider_token. */
export const googleProviders = new Set([googleCalendarProvider.id, gmailProvider.id]);

export function getProvider(id: string): Provider | undefined {
  return providers[id];
}
