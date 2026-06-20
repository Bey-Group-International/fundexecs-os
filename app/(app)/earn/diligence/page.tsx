import { redirect } from "next/navigation";
import Link from "next/link";
import { getSessionContext } from "@/lib/auth";
import { DiligenceConsole } from "./DiligenceConsole";

export const dynamic = "force-dynamic";

// Earn Diligence Brain — "ask your fund documents what matters."
export default async function DiligencePage() {
  const ctx = await getSessionContext();
  if (!ctx) redirect("/login");
  if (!ctx.orgId) redirect("/onboarding");

  return (
    <div className="fx-ambient mx-auto max-w-3xl">
      <header className="mb-6">
        <p className="font-mono text-[11px] uppercase tracking-[0.25em] text-gold-400">
          Earn · Diligence Brain
        </p>
        <h1 className="mt-1 font-display text-3xl font-semibold tracking-tight text-fg-primary">
          Ask your fund documents what matters.
        </h1>
        <p className="mt-2 max-w-xl text-sm text-fg-secondary">
          Paste a deck, CIM, PPM, financials, or call notes, pick a question, and the right Brain
          reviews it — institutional-grade, with its reasoning and tools shown.{" "}
          <Link href="/earn" className="text-gold-400 hover:underline">
            Back to Earn
          </Link>
        </p>
      </header>

      <DiligenceConsole />
    </div>
  );
}
