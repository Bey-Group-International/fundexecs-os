import { redirect } from 'next/navigation';

/**
 * /integrations — redirect shim. The OAuth connect/callback routes (and older
 * links) land here; the surface itself now lives at Settings → Integrations.
 * `connected` / `error` params are carried through so the banner renders.
 */
export default async function IntegrationsRedirect({
  searchParams
}: {
  searchParams: Promise<{ connected?: string; error?: string }>;
}) {
  const params = await searchParams;
  const target = new URLSearchParams({ tab: 'integrations' });
  if (params.connected) target.set('connected', params.connected);
  if (params.error) target.set('error', params.error);
  redirect(`/settings?${target.toString()}`);
}
