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
// sign-in wall — the recipient of an invite has no account yet, so "Request
// access" is the way in. Both actions route back through /join?ref=CODE, which
// sets the referral cookie before forwarding; a Server Component can't write
// one itself.
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
  const requestHref = `/join${query}next=%2Frequest-access`;
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
            The operating system for private markets — deal sourcing, diligence,
            underwriting, LP relations and reporting, in one place.
          </p>
          <p className="mt-2 text-sm text-fg-secondary">
            {invite
              ? "FundExecs is invite-only. This link puts your request in front of the team with the invitation already attached."
              : "FundExecs is invite-only. Request access below and we'll be in touch."}
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

          {/* The drop-off on an invite-only product is not "is this good?" but
              "what happens if I click?". Three lines answer it. */}
          <ol className="mt-5 flex flex-col gap-3 border-t border-line/60 pt-5">
            {[
              {
                n: 1,
                title: "Tell us about your firm",
                detail: "A short form — name, firm, what you invest in.",
              },
              {
                n: 2,
                title: "We review it by hand",
                detail: "Every request, with your invitation attached to it.",
              },
              {
                n: 3,
                title: "Your workspace opens",
                detail: "We email you the moment it's ready.",
              },
            ].map((step) => (
              <li key={step.n} className="flex gap-3">
                <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-gold-400/40 bg-gold-400/10 font-mono text-[11px] text-gold-300">
                  {step.n}
                </span>
                <div className="text-sm">
                  <p className="font-medium text-fg-primary">{step.title}</p>
                  <p className="mt-0.5 text-xs text-fg-secondary">{step.detail}</p>
                </div>
              </li>
            ))}
          </ol>

          <Link
            href={requestHref}
            className="mt-6 flex w-full items-center justify-center rounded-md bg-gold-400 px-4 py-2.5 text-sm font-medium text-on-gold transition hover:bg-gold-300"
          >
            Request access
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
