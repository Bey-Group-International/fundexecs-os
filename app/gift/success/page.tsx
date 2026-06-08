import type { Metadata } from 'next';
import Link from 'next/link';
import { CheckCircle2, Clock } from 'lucide-react';
import { AccountPageShell } from '@/components/account/AccountPageShell';
import { finalizePaidGift } from '@/lib/queries/gift';
import { getSiteURL } from '@/lib/site-url';
import { GiftSuccessActions } from './GiftSuccessActions';

export const metadata: Metadata = {
  title: 'Gift sent · FundExecs',
  robots: { index: false }
};

export default async function GiftSuccessPage({
  searchParams
}: {
  searchParams: Promise<{ session_id?: string }>;
}) {
  const { session_id } = await searchParams;
  const activation = session_id ? await finalizePaidGift(session_id) : null;

  if (!activation) {
    return (
      <AccountPageShell eyebrow="Gift" title="Finalizing your gift">
        <div className="rounded-2xl border border-hairline bg-surface-1 p-5">
          <span className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-hairline bg-surface-2 text-fg-3">
            <Clock size={18} strokeWidth={1.9} aria-hidden />
          </span>
          <p className="mt-3 text-[13.5px] text-fg-2">
            Your payment is confirming. This page will show the redeem link in a moment — refresh if
            it doesn&apos;t appear shortly.
          </p>
          <div className="mt-4">
            <Link
              href="/gift/success"
              className="text-[12.5px] font-medium text-azure-1 hover:underline"
            >
              Refresh
            </Link>
          </div>
        </div>
      </AccountPageShell>
    );
  }

  const redeemUrl = `${getSiteURL()}/gift/claim?code=${encodeURIComponent(activation.code)}`;

  return (
    <AccountPageShell
      eyebrow="Gift sent"
      title="Your gift is on its way 🎁"
      intro={`${activation.credits.toLocaleString()} Earn credits are ready to redeem.`}
    >
      <div className="rounded-2xl border border-[var(--gold-line)] bg-[var(--gold-soft)] p-5">
        <span className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-[var(--gold-line)] bg-bg-1 text-gold-1">
          <CheckCircle2 size={18} strokeWidth={1.9} aria-hidden />
        </span>
        <p className="mt-3 text-[13.5px] leading-6 text-fg-2">
          {activation.emailSent && activation.recipientEmail ? (
            <>
              We emailed the redeem link to{' '}
              <span className="font-semibold text-fg-1">{activation.recipientEmail}</span>. You can
              also share it directly below.
            </>
          ) : (
            <>Share this redeem link with your recipient so they can claim their credits:</>
          )}
        </p>

        <code className="mt-3 block truncate rounded-lg border border-hairline bg-bg-1 px-3 py-2 font-mono text-[12px] text-fg-2">
          {redeemUrl}
        </code>

        <GiftSuccessActions redeemUrl={redeemUrl} recipientEmail={activation.recipientEmail} />
      </div>
    </AccountPageShell>
  );
}
