import type { Metadata } from 'next';
import Link from 'next/link';
import { Gift, Sparkles } from 'lucide-react';
import { AccountPageShell } from '@/components/account/AccountPageShell';
import { EarnCoin } from '@/components/screens/EarnCoin';
import { createClient } from '@/lib/supabase/server';
import { getActiveOrg } from '@/lib/queries/org';
import { getGiftByCode } from '@/lib/queries/gift';
import { RedeemPanel } from './RedeemPanel';

export const metadata: Metadata = {
  title: 'Redeem your gift · FundExecs',
  robots: { index: false }
};

function Notice({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-2xl border border-hairline bg-surface-1 p-5">
      <span className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-hairline bg-surface-2 text-fg-3">
        <Gift size={18} strokeWidth={1.9} aria-hidden />
      </span>
      <h2 className="mt-3 text-[15px] font-semibold text-fg-1">{title}</h2>
      <p className="mt-1 text-[13px] leading-6 text-fg-3">{body}</p>
    </div>
  );
}

export default async function GiftClaimPage({
  searchParams
}: {
  searchParams: Promise<{ code?: string }>;
}) {
  const { code } = await searchParams;
  const gift = code ? await getGiftByCode(code) : null;

  if (!code || !gift) {
    return (
      <AccountPageShell eyebrow="Gift" title="Redeem your gift">
        <Notice
          title="This gift link isn't valid"
          body="Double-check the link from your email. If it keeps failing, ask the sender to resend it."
        />
      </AccountPageShell>
    );
  }

  if (gift.status === 'redeemed') {
    return (
      <AccountPageShell eyebrow="Gift" title="Redeem your gift">
        <Notice
          title="This gift has already been redeemed"
          body="These credits have been claimed. If you didn't redeem it, contact the sender."
        />
      </AccountPageShell>
    );
  }

  if (gift.status !== 'active') {
    return (
      <AccountPageShell eyebrow="Gift" title="Redeem your gift">
        <Notice
          title="This gift isn't ready yet"
          body="The payment is still confirming. Refresh this page in a moment to redeem your credits."
        />
      </AccountPageShell>
    );
  }

  const {
    data: { user }
  } = await (await createClient()).auth.getUser();
  const org = user ? await getActiveOrg() : null;
  const signInHref = `/login?next=${encodeURIComponent(`/gift/claim?code=${code}`)}`;

  return (
    <AccountPageShell
      eyebrow="You've received a gift"
      title={gift.senderName ? `${gift.senderName} sent you credits` : 'A gift for you'}
      intro="Redeem these Earn credits into your FundExecs workspace — fuel for your AI Chief Operating Officer."
    >
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="space-y-5">
          {!user ? (
            <div className="rounded-2xl border border-hairline bg-surface-1 p-5">
              <h2 className="text-[15px] font-semibold text-fg-1">Sign in to redeem</h2>
              <p className="mt-1 text-[13px] leading-6 text-fg-3">
                Your {gift.credits.toLocaleString()} credits land in whichever workspace you sign
                into. Create an account or sign in to claim them.
              </p>
              <Link
                href={signInHref}
                className="mt-4 inline-flex items-center gap-1.5 rounded-xl bg-[linear-gradient(135deg,#3B74F0,#2152D8)] px-4 py-2 text-[12.5px] font-semibold text-white transition hover:brightness-110"
              >
                Sign in to claim
              </Link>
            </div>
          ) : !org ? (
            <Notice
              title="Finish setting up your workspace"
              body="You're signed in, but we couldn't find an active workspace to credit. Complete onboarding, then reopen this link to redeem."
            />
          ) : (
            <RedeemPanel code={code} credits={gift.credits} />
          )}
        </div>

        {/* Gift card */}
        <div className="lg:sticky lg:top-6 lg:self-start">
          <div className="relative overflow-hidden rounded-2xl border border-[var(--gold-line)] bg-[linear-gradient(150deg,rgba(247,201,72,0.16),rgba(247,201,72,0.03)_55%,transparent)] p-5">
            <div className="flex items-center justify-between">
              <span className="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-gold-1">
                FundExecs gift
              </span>
              <EarnCoin size={30} glow />
            </div>
            <div className="mt-5 flex items-end gap-1.5">
              <span className="text-[40px] font-semibold leading-none tabular-nums tracking-[-0.03em] text-fg-1">
                {gift.credits.toLocaleString()}
              </span>
              <span className="mb-1 text-[13px] font-medium text-fg-3">Earn credits</span>
            </div>
            {gift.senderName ? (
              <p className="mt-5 text-[12.5px] text-fg-3">
                <span className="text-fg-5">From </span>
                <span className="font-medium text-fg-1">{gift.senderName}</span>
              </p>
            ) : null}
            {gift.message ? (
              <p className="mt-4 rounded-xl border border-[var(--gold-line)] bg-[var(--gold-soft)] px-3 py-2 text-[12.5px] italic leading-6 text-fg-2">
                “{gift.message}”
              </p>
            ) : null}
            <p className="mt-4 flex items-center gap-1.5 text-[11px] text-fg-4">
              <Sparkles size={12} strokeWidth={2} className="text-gold-1" aria-hidden />
              Credits never expire
            </p>
          </div>
        </div>
      </div>
    </AccountPageShell>
  );
}
