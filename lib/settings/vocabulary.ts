/* ============================================================================
 * lib/settings/vocabulary.ts — the pure vocabulary of the Settings surface:
 * section tabs and the OAuth handoff banner. No React, no icons — safe to
 * import anywhere (server page, client flow, unit test).
 * ========================================================================= */

export const SETTINGS_TABS = [
  { id: 'account', label: 'Account' },
  { id: 'workspace', label: 'Workspace' },
  { id: 'integrations', label: 'Integrations' }
] as const;

export type SettingsTabId = (typeof SETTINGS_TABS)[number]['id'];

/** Coerce an untrusted `?tab=` value to a valid section, defaulting to Account. */
export function resolveSettingsTab(value: unknown): SettingsTabId {
  return SETTINGS_TABS.some((t) => t.id === value) ? (value as SettingsTabId) : 'account';
}

/**
 * The banner the Integrations section shows after an OAuth round-trip. The
 * connect/callback routes hand back `?connected={provider}` on success and
 * `?error={message}` on failure; error wins when both are present (a failed
 * flow can still carry a stale `connected` param through redirects).
 */
export type OAuthBanner = { tone: 'success' | 'danger'; message: string } | null;

export function oauthBanner(connected: string | undefined, error: string | undefined): OAuthBanner {
  if (error) return { tone: 'danger', message: error };
  if (!connected) return null;
  const name = connected === 'google' ? 'Google' : connected.replace(/_/g, ' ');
  return { tone: 'success', message: `Connected ${name} — you're wired in.` };
}
