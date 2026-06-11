import type { Metadata } from 'next';
import { AuroraBackdrop } from '@/components/ui/AuroraBackdrop';
import { LoginCard } from './LoginCard';

export const metadata: Metadata = { title: 'Sign in' };

/**
 * Sign in — the simplified flow's single entry gate (the prototype's Invite +
 * Sign-in screens merged onto one card). Reads search params server-side so the
 * client card needs no Suspense boundary around `useSearchParams`.
 */
export default async function LoginPage({
  searchParams
}: {
  searchParams: Promise<{ redirectedFrom?: string; error?: string; error_description?: string }>;
}) {
  const params = await searchParams;
  const requested = params.redirectedFrom ?? '';
  // Only allow same-origin relative paths to avoid open redirects.
  const redirectedFrom =
    requested.startsWith('/') && !requested.startsWith('//') ? requested : '/command-center';
  const oauthError = params.error_description || params.error || null;

  return (
    <main className="relative flex min-h-dvh items-center justify-center overflow-hidden bg-bg-0 px-6 py-12 text-fg-1">
      <AuroraBackdrop />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background: 'radial-gradient(40% 36% at 50% 24%, rgba(247,201,72,0.1), transparent 70%)'
        }}
      />
      <LoginCard redirectedFrom={redirectedFrom} oauthError={oauthError} />
    </main>
  );
}
