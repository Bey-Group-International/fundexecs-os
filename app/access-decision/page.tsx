import type { Metadata } from "next";
import Link from "next/link";
import { Logo } from "@/components/Logo";
import { lookupDecisionToken } from "@/lib/access-requests";
import { confirmAccessDecision } from "./actions";

// Never indexed: the URL carries a credential, and there is nothing here for a
// crawler anyway.
export const metadata: Metadata = {
  title: "Access decision",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="fx-blueprint flex min-h-screen items-center justify-center bg-surface-0 px-4 py-20">
      <div className="fx-glass w-full max-w-md p-6">
        <Logo className="mb-8" />
        {children}
      </div>
    </div>
  );
}

/**
 * The landing pad for the Approve / Decline buttons in the internal alert email.
 *
 * This page never acts on its own. Opening the link only READS the token and
 * renders what the reader is about to do; the grant happens on the POST behind
 * the confirm button. That split is deliberate: mail scanners, link previewers
 * and "safe browsing" prefetchers follow every URL in an inbound message, and a
 * GET that approved someone would hand access to whichever bot got there first.
 */
export default async function AccessDecisionPage(props: {
  searchParams: Promise<{
    token?: string;
    decision?: string;
    done?: string;
    error?: string;
  }>;
}) {
  const searchParams = await props.searchParams;

  // Post-decision confirmation. Rendered from the outcome alone — the token is
  // spent by now, and the requester's details don't belong in a URL.
  if (searchParams.done === "approved" || searchParams.done === "declined") {
    const approved = searchParams.done === "approved";
    return (
      <Shell>
        <h1 className="text-2xl font-semibold tracking-tight text-fg-primary">
          {approved ? "Access approved" : "Request declined"}
        </h1>
        <p className="mt-2 text-sm text-fg-secondary">
          {approved
            ? "They've been emailed an invitation and can sign in now. Nothing else to do."
            : "The request is marked declined. They keep no access and are not notified."}
        </p>
        <Link
          href="/admin"
          className="mt-6 inline-block rounded-md bg-gold-400 px-4 py-2.5 text-sm font-medium text-on-gold transition hover:opacity-90"
        >
          Open the admin console
        </Link>
      </Shell>
    );
  }

  const token = typeof searchParams.token === "string" ? searchParams.token : "";
  const decision = searchParams.decision === "decline" ? "decline" : "approve";
  const request = token ? await lookupDecisionToken(token) : null;

  // One message for unknown, expired and already-used, so the page tells a
  // stranger holding a stale link nothing about whether it ever meant anything.
  if (!request) {
    return (
      <Shell>
        <h1 className="text-2xl font-semibold tracking-tight text-fg-primary">
          This link is no longer valid
        </h1>
        <p className="mt-2 text-sm text-fg-secondary">
          {searchParams.error ??
            "Access-decision links are single-use and expire after 14 days. The request may already have been decided."}
        </p>
        <Link
          href="/admin"
          className="mt-6 inline-block rounded-md bg-gold-400 px-4 py-2.5 text-sm font-medium text-on-gold transition hover:opacity-90"
        >
          Open the admin console
        </Link>
      </Shell>
    );
  }

  const approving = decision === "approve";
  const other = approving ? "decline" : "approve";

  return (
    <Shell>
      <h1 className="text-2xl font-semibold tracking-tight text-fg-primary">
        {approving ? "Approve access?" : "Decline this request?"}
      </h1>
      <p className="mt-2 text-sm text-fg-secondary">
        {approving
          ? "They'll be emailed an invitation and can sign in straight away."
          : "They'll get no access. We don't email them about it."}
      </p>

      <dl className="mt-5 space-y-2 border-t border-line/60 pt-4">
        {(
          [
            ["Name", request.fullName],
            ["Email", request.email],
            ["Firm", request.firm],
            ["Role", request.role],
          ] as [string, string | null][]
        ).map(([label, value]) => (
          <div key={label} className="flex gap-3">
            <dt className="w-16 shrink-0 font-mono text-[11px] uppercase tracking-[0.12em] text-fg-muted">
              {label}
            </dt>
            <dd className="min-w-0 break-words text-sm text-fg-primary">
              {value || "—"}
            </dd>
          </div>
        ))}
      </dl>

      {request.note ? (
        <p className="mt-4 border-l-2 border-gold-500/40 pl-3 text-sm text-fg-secondary">
          {request.note}
        </p>
      ) : null}

      <form action={confirmAccessDecision} className="mt-6">
        <input type="hidden" name="token" value={token} />
        <input type="hidden" name="decision" value={decision} />
        <button
          type="submit"
          className={
            approving
              ? "w-full rounded-md bg-gold-400 py-2.5 text-sm font-medium text-on-gold transition hover:opacity-90"
              : "w-full rounded-md border border-line py-2.5 text-sm font-medium text-fg-primary transition hover:bg-surface-2"
          }
        >
          {approving ? "Yes, approve access" : "Yes, decline"}
        </button>
      </form>

      <p className="mt-4 text-center text-sm text-fg-muted">
        <Link
          href={`/access-decision?token=${encodeURIComponent(token)}&decision=${other}`}
          className="text-gold-300 hover:underline"
        >
          {approving ? "Decline instead" : "Approve instead"}
        </Link>
      </p>
    </Shell>
  );
}
