import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { AuroraBackdrop } from '@/components/ui/AuroraBackdrop';
import { Badge } from '@/components/ui/Badge';
import { EarnCoin } from '@/components/ui/EarnCoin';
import { signOutAction } from '@/app/(shell)/actions';

export const metadata: Metadata = { title: 'Your desk is being prepared' };

/** Pull a trimmed string out of the captured mandate blob. */
function mandateField(mandate: Record<string, unknown> | null, key: string): string | null {
  if (!mandate) return null;
  const value = mandate[key];
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

/**
 * Pending — the holding screen for a member who has briefed their team but is
 * awaiting (or has been declined) an admin's access decision. The door is open
 * (they signed up and onboarded; the mandate is captured), but full entry is
 * gated by the beta-approval middleware. Rather than a dead waiting-room, we
 * play back exactly what Earn captured so the value is visible while they wait.
 *
 * The middleware only routes a completed-but-not-approved member here; a
 * fully-approved member is bounced to /command-center, so this page assumes the
 * gate already decided. It still reads the row defensively.
 */
export default async function PendingPage() {
  const supabase = await createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();
  if (!user) redirect('/login?redirectedFrom=/pending');

  const { data: profile } = await supabase
    .from('member_profiles')
    .select('access_status, display_name, headline, details')
    .eq('user_id', user.id)
    .maybeSingle();

  // Defensive: if the middleware's view and this read disagree (e.g. just
  // approved between requests), send them on in rather than stranding them.
  if (profile?.access_status === 'approved') redirect('/command-center');

  const rejected = profile?.access_status === 'rejected';
  const details = (profile?.details ?? null) as Record<string, unknown> | null;
  const mandate =
    details && typeof details.mandate === 'object' && details.mandate !== null
      ? (details.mandate as Record<string, unknown>)
      : null;

  const name = profile?.display_name?.trim() || null;
  const recap = [
    ['Role', mandateField(mandate, 'investorRole')],
    ['Objective', mandateField(mandate, 'objective')],
    ['Vehicle', mandateField(mandate, 'vehicle')],
    ['Target size', mandateField(mandate, 'size')],
    ['Stage', mandateField(mandate, 'stage')],
    ['Geography', mandateField(mandate, 'geo')]
  ].filter(([, value]) => value) as [string, string][];
  const sectors = Array.isArray(mandate?.sectors)
    ? (mandate.sectors as unknown[]).filter((s): s is string => typeof s === 'string').slice(0, 8)
    : [];

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

      <div className="fx-rise relative z-10 w-full max-w-[520px]">
        <div className="mb-6 flex flex-col items-center text-center">
          <div className="relative mb-4">
            <div
              aria-hidden
              className="absolute -inset-2.5 rounded-full blur-[8px]"
              style={{
                background: 'radial-gradient(circle, rgba(247,201,72,0.45), transparent 70%)'
              }}
            />
            <div className="relative">
              <EarnCoin size={56} />
            </div>
          </div>
          <Badge tone={rejected ? 'neutral' : 'azure'} dot pulse={!rejected} className="mb-3">
            {rejected ? 'Application reviewed' : 'Reviewing your application'}
          </Badge>
          <h1 className="text-[24px] font-semibold tracking-[-0.02em]">
            {rejected
              ? 'Thanks for your interest'
              : name
                ? `Your desk is being prepared, ${name}`
                : 'Your desk is being prepared'}
          </h1>
          <p className="mt-2 max-w-[420px] text-[13px] leading-relaxed text-fg-3">
            {rejected
              ? 'We’re not able to open access right now. Your brief is saved — if anything changes we’ll reach out at the email on file.'
              : 'Earn has your brief and the fifteen-specialist team is being assigned to your mandate. A member of the Bey Group team approves each new desk during the private beta — you’ll get an email the moment yours is live.'}
          </p>
        </div>

        {recap.length > 0 || sectors.length > 0 ? (
          <div className="rounded-2xl border border-hairline bg-bg-1 p-6 shadow-[var(--shadow-lg)]">
            <h2 className="text-[13px] font-semibold tracking-tight text-fg-2">
              {profile?.headline?.trim() || 'What Earn captured from your brief'}
            </h2>
            {recap.length > 0 && (
              <dl className="mt-4 grid grid-cols-2 gap-x-5 gap-y-3">
                {recap.map(([label, value]) => (
                  <div key={label}>
                    <dt className="text-[11px] uppercase tracking-[0.08em] text-fg-5">{label}</dt>
                    <dd className="mt-0.5 text-[13px] text-fg-1">{value}</dd>
                  </div>
                ))}
              </dl>
            )}
            {sectors.length > 0 && (
              <div className="mt-4">
                <p className="text-[11px] uppercase tracking-[0.08em] text-fg-5">Focus sectors</p>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {sectors.map((sector) => (
                    <span
                      key={sector}
                      className="rounded-lg border border-hairline bg-surface-2 px-2.5 py-1 text-[12px] text-fg-2"
                    >
                      {sector}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        ) : null}

        <form action={signOutAction} className="mt-6 text-center">
          <button type="submit" className="text-[12.5px] text-fg-4 transition hover:text-fg-2">
            Sign out
          </button>
        </form>
        <p className="mt-4 text-center text-[11px] text-fg-5">
          Secured by Supabase Auth · SOC 2 · RLS
        </p>
      </div>
    </main>
  );
}
