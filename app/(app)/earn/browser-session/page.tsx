import { redirect } from "next/navigation";
import Link from "next/link";
import { getSessionContext } from "@/lib/auth";
import { BrowserControlPanel } from "@/components/earn/BrowserControlPanel";

export const dynamic = "force-dynamic";

// Earn Controlled Browser-Operator — the operator's cockpit for letting Earn
// research on the web safely: scope approval, credential-safe auth handoff,
// review-before-save, and a full audit trail.
export default async function BrowserSessionPage() {
  const ctx = await getSessionContext();
  if (!ctx) redirect("/login");
  if (!ctx.orgId) redirect("/onboarding");

  return (
    <div className="fx-ambient mx-auto max-w-3xl">
      <header className="mb-6">
        <p className="font-mono text-[11px] uppercase tracking-[0.25em] text-gold-400">
          Earn · Controlled Browser Operator
        </p>
        <h1 className="mt-1 font-display text-3xl font-semibold tracking-tight text-fg">
          Let Earn research the web — with your hand on the controls.
        </h1>
        <p className="mt-2 max-w-xl text-sm text-fg-muted">
          Earn proposes a scope before it opens a browser, pauses for you to sign
          in directly (it never sees your password), and shows you everything it
          found for approval before anything is saved.{" "}
          <Link href="/earn" className="text-gold-400 hover:underline">
            Back to Earn
          </Link>
        </p>
      </header>

      <BrowserControlPanel />
    </div>
  );
}
