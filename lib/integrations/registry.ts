import type { Provider } from './types';
import { googleCalendarProvider } from './providers/google-calendar';
import { gmailProvider } from './providers/gmail';
import { googleDriveProvider } from './providers/google-drive';
import { googleDocsProvider } from './providers/google-docs';
import { googleSlidesProvider } from './providers/google-slides';
import { googleMeetProvider } from './providers/google-meet';
import { calendlyProvider } from './providers/calendly';
import { slackProvider } from './providers/slack';
import { zoomProvider } from './providers/zoom';
import { apolloProvider } from './providers/apollo';
import { GOOGLE_PROVIDERS } from './constants';

/**
 * Providers wired for ingestion. Every provider resolves its access token from
 * private.integration_secrets; public integration_connections rows only carry
 * status, scopes and non-secret account metadata.
 */
export const providers: Record<string, Provider> = {
  [googleCalendarProvider.id]: googleCalendarProvider,
  [gmailProvider.id]: gmailProvider,
  [googleDriveProvider.id]: googleDriveProvider,
  [googleDocsProvider.id]: googleDocsProvider,
  [googleSlidesProvider.id]: googleSlidesProvider,
  [googleMeetProvider.id]: googleMeetProvider,
  [calendlyProvider.id]: calendlyProvider,
  [slackProvider.id]: slackProvider,
  [zoomProvider.id]: zoomProvider,
  [apolloProvider.id]: apolloProvider
};

export const googleProviders = GOOGLE_PROVIDERS;

export function getProvider(id: string): Provider | undefined {
  return providers[id];
}
