export const GOOGLE_PROVIDER_IDS = [
  'gmail',
  'google_calendar',
  'google_drive',
  'google_docs',
  'google_slides',
  'google_meet'
] as const;

export type GoogleProviderId = (typeof GOOGLE_PROVIDER_IDS)[number];

export const GOOGLE_PROVIDERS = new Set<string>(GOOGLE_PROVIDER_IDS);

export const GOOGLE_SCOPES = [
  'https://www.googleapis.com/auth/gmail.metadata',
  'https://www.googleapis.com/auth/calendar.readonly',
  'https://www.googleapis.com/auth/drive.readonly'
] as const;

export const GOOGLE_SCOPE_STRING = GOOGLE_SCOPES.join(' ');

export const INTEGRATION_GOOGLE_INTENT_COOKIE = 'fundexecs.integration.google_provider';

export const OAUTH_PROVIDER_IDS = ['slack', 'calendly', 'zoom'] as const;

export type OAuthProviderId = (typeof OAUTH_PROVIDER_IDS)[number];

export const OAUTH_PROVIDERS = new Set<string>(OAUTH_PROVIDER_IDS);

export const API_KEY_PROVIDER_IDS = ['apollo'] as const;

export const API_KEY_PROVIDERS = new Set<string>(API_KEY_PROVIDER_IDS);

export function integrationStateCookie(provider: string) {
  return `fundexecs.integration.${provider}.state`;
}

export function integrationVerifierCookie(provider: string) {
  return `fundexecs.integration.${provider}.verifier`;
}
