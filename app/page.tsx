import Link from 'next/link';
import { ArrowRight, Lock } from 'lucide-react';
import { AuroraBackdrop } from '@/components/ui/AuroraBackdrop';
import { Badge } from '@/components/ui/Badge';
import { EarnCoin } from '@/components/ui/EarnCoin';

const PROOF_STATS = [
  ['$500M+', 'raises supported'],
  ['15', 'AI specialists'],
  ['4-layer', 'Chain of Trust']
] as const;

/**
 * Landing — the simplified onboarding flow's entry screen. One promise
 * ("set the mandate, the team does the rest"), one CTA into the invite-only
 * sign-in. Ported from the onboarding prototype's `Landing`, restyled to the
 * app's tokens.
 */
export default function HomePage() {
  return (
    <main className="relative flex min-h-dvh flex-col overflow-hidden bg-bg-0 text-fg-1">
      <AuroraBackdrop />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background: 'radial-gradient(46% 38% at 50% 30%, rgba(247,201,72,0.07), transparent 70%)'
        }}
      />

      <header className="relative z-10 flex items-center justify-between px-[clamp(20px,5vw,52px)] py-5">
        <div className="flex items-center gap-2.5">
          <EarnCoin size={30} />
          <span className="text-[16px] font-semibold tracking-[-0.02em]">
            FundExecs <span className="font-medium text-fg-4">OS</span>
          </span>
        </div>
        <Link
          href="/login"
          className="rounded-xl border border-hairline bg-surface-1 px-3.5 py-2 text-[13px] text-fg-3 transition hover:bg-surface-2 hover:text-fg-1"
        >
          Sign in
        </Link>
      </header>

      <div className="relative z-10 mx-auto flex w-full max-w-[920px] flex-1 flex-col items-center justify-center px-[clamp(20px,5vw,52px)] pb-14 pt-6 text-center">
        <Badge tone="azure" dot pulse className="mb-6">
          Invite-only private beta
        </Badge>
        <h1 className="text-[clamp(34px,6vw,60px)] font-semibold leading-[1.04] tracking-[-0.03em]">
          Set the mandate.
          <br />
          Your AI executive team <span className="text-gold-1">does the rest.</span>
        </h1>
        <p className="mt-6 max-w-[620px] text-[clamp(14px,1.6vw,17px)] leading-relaxed text-fg-3">
          Fifteen specialists, led by Earn, launch the fund, raise the capital, source the deals,
          and drive every engagement to a signed close. You set direction and approve — they
          execute. From a student-led first fund to a $500M raise.
        </p>

        <div className="mt-8 flex flex-wrap items-center justify-center gap-4">
          <Link
            href="/login"
            className="inline-flex items-center gap-2 rounded-xl bg-[linear-gradient(135deg,#F7C948,#E5A823)] px-6 py-3 text-[14.5px] font-semibold text-[#070b14] shadow-[0_1px_2px_rgba(0,0,0,0.2),0_8px_20px_-8px_rgba(247,201,72,0.55)] transition hover:brightness-105"
          >
            Claim your desk
            <ArrowRight size={16} strokeWidth={2.2} aria-hidden />
          </Link>
          <span className="inline-flex items-center gap-1.5 text-[12.5px] text-fg-4">
            <Lock size={14} strokeWidth={1.9} aria-hidden /> By referral · no card, no setup
          </span>
        </div>

        <div className="mt-12 flex flex-wrap justify-center gap-[clamp(24px,5vw,48px)]">
          {PROOF_STATS.map(([value, label]) => (
            <div key={label}>
              <div className="text-[28px] font-semibold tracking-[-0.02em] [font-feature-settings:'tnum']">
                {value}
              </div>
              <div className="mt-1 text-[12px] text-fg-4">{label}</div>
            </div>
          ))}
        </div>
      </div>

      <footer className="relative z-10 flex items-center justify-center gap-2.5 pb-8 text-[12px] text-fg-4">
        <EarnCoin size={22} />
        <span>
          <b className="font-semibold text-fg-2">Earn</b> — Chief Operating Officer of your live AI
          executive team.
        </span>
      </footer>
    </main>
  );
}
