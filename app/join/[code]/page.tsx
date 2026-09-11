import type { Metadata } from "next";
import Link from "next/link";
import { Logo } from "@/components/Logo";
import { getReferralInvite } from "@/lib/gift-earn";
import { normalizeReferralCode } from "@/lib/referral-link";
import { formatCredits } from "@/lib/billing";
import { REFERRAL_WELCOME_BONUS } from "@/lib/referrals";

export const dynamic = "force-dynamic";

// A shared invite names the firm that sent it, so keep these pages out of search
// results even though the route itself is public.
export const metadata: Metadata = {
  title: "You're invited",
  robots: { index: false, follow: false },
};

// The page a referral link opens: /join/CODE
//
// Signed-out strangers land here, so it reads as an invitation rather than a
// sign-in wall — the recipient of an invite has no account yet, so creating one
// is the way in. Both actions route back through /join?ref=CODE, which sets the
// referral cookie before forwarding; a Server Component can't write one itself.
//
// An unknown code still renders, minus the firm's name. Someone who mistyped a
// character should get an invitation, not an error page.
export default async function JoinInvitePage(props: {
  params: Promise<{ code: string }>;
}) {
  const { code: rawCode } = await props.params;
  // Next hands this over already decoded, so decoding again would throw on a
  // stray "%" and 500 the page instead of rendering the generic invitation.
  const code = normalizeReferralCode(rawCode);
  const invite = code ? await getReferralInvite(code) : null;

  const query = code ? `?ref=${encodeURIComponent(code)}&` : "?";
  const signUpHref = `/join${query}next=%2Flogin%3Fmode%3Dsignup`;
  const signInHref = `/join${query}next=%2Flogin`;

  return (
    <div className="fx-blueprint flex min-h-screen bg-surface-0">
      {/* Left branding panel — mirrors /login and /request-access so every entry
          point into the product reads as one thing. */}
      <div className="hidden w-2/5 flex-col justify-between border-r border-line bg-surface-1/55 p-12 backdrop-blur-xl lg:flex">
        <Logo />
        <div>
          <p className="text-2xl font-semibold leading-snug tracking-tight text-fg-primary">
            The Operating System<br />for Private Markets
          </p>
          <p className="mt-3 text-sm text-fg-secondary">
            One OS for deal sourcing, LP relations, diligence, underwriting,
            capital events, and exit. Built for GPs, family offices, and
            advisory professionals.
          </p>
        </div>
        <p className="font-mono text-xs text-fg-muted">Early Access</p>
      </div>

      {/* Right panel — the invitation */}
      <div className="flex flex-1 flex-col items-center justify-center px-4 py-20 sm:px-6">
        <div className="fx-glass w-full max-w-lg p-5 sm:p-7">
          <Logo className="mb-8 block lg:hidden" />

          <span className="font-mono text-[11px] uppercase tracking-[0.16em] text-gold-300/80">
            You&apos;re invited
          </span>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight text-fg-primary">
            {invite ? (
              <>
                <span className="text-gold-300">{invite.orgName}</span> invited you to
                FundExecs
              </>
            ) : (
              "You've been invited to FundExecs"
            )}
          </h1>
          <p className="mt-1.5 text-sm text-fg-secondary">
            {invite
              ? "Create your account below and the invitation — and its credits — come with you."
              : "Create your account below to get started."}
          </p>

          {/* The welcome bonus — the concrete thing the invite is worth. Only
              shown when the code actually resolves: an unrecognised one grants
              nothing, and promising credits we won't pay is worse than a plain
              invitation. */}
          {invite && (
            <div className="mt-5 flex items-center gap-3 rounded-xl border border-gold-400/25 bg-gold-400/[0.06] px-4 py-3">
              <span className="text-xl text-gold-300 drop-shadow-[0_0_14px_rgb(var(--fx-gold-rgb)/0.6)]">
                ◇
              </span>
              <div className="min-w-0">
                <p className="text-sm font-medium text-fg-primary">
                  {formatCredits(REFERRAL_WELCOME_BONUS)} credits to start
                </p>
                <p className="mt-0.5 text-xs text-fg-secondary">
                  Added to your wallet the moment your workspace opens.
                </p>
              </div>
            </div>
          )}

          <Link
            href={signUpHref}
            className="mt-6 flex w-full items-center justify-center rounded-md bg-gold-400 px-4 py-2.5 text-sm font-medium text-on-gold transition hover:bg-gold-300"
          >
            Create your account
          </Link>

          <p className="mt-5 text-center text-sm text-fg-muted">
            Already have an account?{" "}
            <Link href={signInHref} className="text-gold-300 hover:underline">
              Sign in
            </Link>
          </p>

          {invite && (
            <p className="mt-6 border-t border-line/60 pt-4 text-center font-mono text-[11px] uppercase tracking-[0.16em] text-fg-muted">
              Invite code {code}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
