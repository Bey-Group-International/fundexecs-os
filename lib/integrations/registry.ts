import type { Provider } from './types';
import { googleCalendarProvider } from './providers/google-calendar';
import { gmailProvider } from './providers/gmail';
import { calendlyProvider } from './providers/calendly';
import { slackProvider } from './providers/slack';
import { apolloProvider } from './providers/apollo';
import { outlookCalendarProvider } from './providers/outlook-calendar';

/**
 * Providers wired for ingestion. The Google providers use the Google
 * `provider_token` from the user's Supabase session. The remaining providers
 * (Calendly, Slack, Apollo, Outlook) each have their own OAuth/API key and
 * resolve their token from `integration_connections.metadata.access_token`.
 */
export const providers: Record<string, Provider> = {
  [googleCalendarProvider.id]: googleCalendarProvider,
  [gmailProvider.id]: gmailProvider,
  [calendlyProvider.id]: calendlyProvider,
  [slackProvider.id]: slackProvider,
  [apolloProvider.id]: apolloProvider,
  [outlookCalendarProvider.id]: outlookCalendarProvider
};

/** Providers that authenticate via the Google session provider_token. */
export const googleProviders = new Set([googleCalendarProvider.id, gmailProvider.id]);

export function getProvider(id: string): Provider | undefined {
  return providers[id];
}
