import type { Metadata } from "next";
import Link from "next/link";
import { Logo } from "@/components/Logo";
import { requestAccess } from "./actions";

export const metadata: Metadata = {
  title: "Request access",
  description:
    "FundExecs OS is invite-only. Tell us about your firm and we'll open a workspace for you.",
};

const FIELD =
  "rounded-md border border-line bg-surface-2 px-3 py-2.5 text-sm text-fg-primary placeholder-fg-muted outline-none transition focus:border-gold-500 focus:bg-surface-2";

// Copy for the three ways an operator lands here from a blocked sign-in
// (lib/access-requests.ts → blockedRedirectPath). `showForm` is false only when
// there is nothing useful to resubmit.
const GATE_NOTICES: Record<string, { message: string; showForm: boolean }> = {
  pending: {
    message:
      "Your access request is in review. We'll email you the moment your workspace is open.",
    showForm: false,
  },
  declined: {
    message:
      "This email isn't approved for FundExecs OS. If you think that's a mistake, reply to the team you've been speaking with.",
    showForm: false,
  },
  required: {
    message:
      "FundExecs OS is invite-only — there's no self-serve sign-up. Request access below and we'll be in touch.",
    showForm: true,
  },
};

export default async function RequestAccessPage(props: {
  searchParams: Promise<{
    submitted?: string;
    error?: string;
    email?: string;
    status?: string;
  }>;
}) {
  const searchParams = await props.searchParams;
  const submitted = searchParams.submitted === "1";
  const gate = searchParams.status ? GATE_NOTICES[searchParams.status] : undefined;
  const email = typeof searchParams.email === "string" ? searchParams.email : "";
  const showForm = !submitted && (gate?.showForm ?? true);

  return (
    <div className="fx-blueprint flex min-h-screen bg-surface-0">
      {/* Left branding panel — mirrors /login so the two entry points read as one product. */}
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
        <p className="font-mono text-xs text-fg-muted">Invite-only · Early Access</p>
      </div>

      {/* Right form panel */}
      <div className="flex flex-1 flex-col items-center justify-center px-4 py-20 sm:px-6">
        <div className="fx-glass w-full max-w-sm p-5 sm:p-6">
          <Logo className="mb-8 block lg:hidden" />

          <h1 className="text-2xl font-semibold tracking-tight text-fg-primary">
            {submitted ? "Request received" : "Request access"}
          </h1>
          <p className="mt-1.5 text-sm text-fg-secondary">
            {submitted
              ? "We review every request by hand. You'll get an email as soon as your workspace is open."
              : "FundExecs OS is invite-only. Tell us about your firm and we'll open a workspace for you."}
          </p>

          {searchParams.error && (
            <p className="mt-4 rounded-md border border-red-500/20 bg-red-500/10 px-3 py-2 text-sm text-red-400">
              {searchParams.error}
            </p>
          )}
          {gate && !submitted && (
            <p className="mt-4 rounded-md border border-gold-500/20 bg-gold-400/10 px-3 py-2 text-sm text-gold-300">
              {gate.message}
            </p>
          )}

          {showForm && (
            <form action={requestAccess} className="mt-6 flex flex-col gap-3">
              <div className="flex flex-col gap-1">
                <label className="text-xs text-fg-secondary" htmlFor="full_name">
                  Full name
                </label>
                <input
                  id="full_name"
                  name="full_name"
                  placeholder="Alex Chen"
                  autoComplete="name"
                  className={FIELD}
                />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-xs text-fg-secondary" htmlFor="email">
                  Work email
                </label>
                <input
                  id="email"
                  name="email"
                  type="email"
                  required
                  defaultValue={email}
                  placeholder="you@yourfirm.com"
                  autoComplete="email"
                  className={FIELD}
                />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-xs text-fg-secondary" htmlFor="firm">
                  Firm
                </label>
                <input
                  id="firm"
                  name="firm"
                  placeholder="Meridian Capital Partners"
                  autoComplete="organization"
                  className={FIELD}
                />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-xs text-fg-secondary" htmlFor="role">
                  Role
                </label>
                <input
                  id="role"
                  name="role"
                  placeholder="Managing Partner"
                  autoComplete="organization-title"
                  className={FIELD}
                />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-xs text-fg-secondary" htmlFor="note">
                  What do you want to run in FundExecs?
                </label>
                <textarea
                  id="note"
                  name="note"
                  rows={3}
                  placeholder="Fund II diligence, LP reporting, deal sourcing…"
                  className={`${FIELD} resize-y`}
                />
              </div>
              <button
                type="submit"
                className="mt-2 rounded-md bg-gold-400 py-2.5 text-sm font-medium text-on-gold transition hover:opacity-90"
              >
                Request access
              </button>
            </form>
          )}

          <p className="mt-5 text-center text-sm text-fg-muted">
            Already have an account?{" "}
            <Link href="/login" className="text-gold-300 hover:underline">
              Sign in
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
