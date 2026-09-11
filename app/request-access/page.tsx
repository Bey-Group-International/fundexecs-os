import type { Metadata } from "next";
import Link from "next/link";
import { Logo } from "@/components/Logo";
import { isApplicantType } from "@/lib/access-request-fields";
import { RequestAccessForm } from "./RequestAccessForm";

export const metadata: Metadata = {
  title: "Request access",
  description:
    "Tell us about your firm and our team will reach out. Or create an account and start now.",
};

// Copy for a blocked sign-in landing here (lib/access-requests.ts →
// blockedRedirectPath). Sign-up is self-serve, so a decline is the only thing
// that still blocks — and there is nothing useful for them to resubmit.
const GATE_NOTICES: Record<string, { message: string; showForm: boolean }> = {
  declined: {
    message:
      "This email isn't approved for FundExecs OS. If you think that's a mistake, reply to the team you've been speaking with.",
    showForm: false,
  },
};

export default async function RequestAccessPage(props: {
  searchParams: Promise<{
    submitted?: string;
    error?: string;
    email?: string;
    status?: string;
    type?: string;
  }>;
}) {
  const searchParams = await props.searchParams;
  const submitted = searchParams.submitted === "1";
  const gate = searchParams.status ? GATE_NOTICES[searchParams.status] : undefined;
  const email = typeof searchParams.email === "string" ? searchParams.email : "";
  const type = isApplicantType(searchParams.type) ? searchParams.type : null;
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
        <p className="font-mono text-xs text-fg-muted">Early Access</p>
      </div>

      {/* Right form panel */}
      <div className="flex flex-1 flex-col items-center justify-center px-4 py-20 sm:px-6">
        <div className="fx-glass w-full max-w-lg p-5 sm:p-7">
          <Logo className="mb-8 block lg:hidden" />

          <h1 className="text-2xl font-semibold tracking-tight text-fg-primary">
            {submitted ? "Request received" : "Request access"}
          </h1>
          <p className="mt-1.5 text-sm text-fg-secondary">
            {submitted
              ? "We read every one by hand. Someone will be in touch shortly."
              : "Tell us about your firm and our team will reach out. You don't have to wait on us, though — you can create an account and start right now."}
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

          {showForm && <RequestAccessForm defaultEmail={email} defaultType={type} />}

          <p className="mt-5 text-center text-sm text-fg-muted">
            <Link href="/login?mode=signup" className="text-gold-300 hover:underline">
              Create an account
            </Link>{" "}
            ·{" "}
            <Link href="/login" className="text-gold-300 hover:underline">
              Sign in
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
