import { redirect } from "next/navigation";
import Link from "next/link";
import { getSessionContext } from "@/lib/auth";
import { FrontDoor } from "./FrontDoor";

export const dynamic = "force-dynamic";

// Earn — the front door. Earnest Fundmaker qualifies whoever lands and routes
// them into the right path. Microcopy per spec: "Earn" / "Ask Earn".
export default async function EarnPage({
  searchParams,
}: {
  searchParams: Promise<{ ask?: string }>;
}) {
  const ctx = await getSessionContext();
  if (!ctx) redirect("/login");
  if (!ctx.orgId) redirect("/onboarding");

  // The mobile home screen (and PWA shortcuts) can deep-link a question in via
  // ?ask=; surface it so the ask isn't lost on the way to the front door.
  const asked = (await searchParams)?.ask?.trim();

  return (
    <div className="fx-ambient mx-auto max-w-3xl">
      <header className="mb-6">
        <p className="font-mono text-[11px] uppercase tracking-[0.25em] text-gold-400">Earn</p>
        <h1 className="mt-1 font-display text-3xl font-semibold tracking-tight text-fg-primary">
          What are we moving forward today?
        </h1>
        <p className="mt-2 max-w-xl text-sm text-fg-secondary">
          Guide your raise, diligence, LP outreach, and fund execution. Earnest will point you to
          the right path — or jump straight to the{" "}
          <Link href="/earn/diligence" className="text-gold-400 hover:underline">
            Diligence Brain
          </Link>
          .
        </p>
      </header>

      {asked && (
        <div className="mb-5 flex items-start gap-3 rounded-2xl border border-gold-500/25 bg-gold-500/[0.06] px-4 py-3">
          <span aria-hidden className="mt-0.5 text-gold-400">✦</span>
          <div className="min-w-0">
            <p className="font-mono text-[10px] uppercase tracking-wider text-gold-400">You asked Earn</p>
            <p className="mt-0.5 text-sm text-fg-primary">“{asked}”</p>
            <p className="mt-1 text-[12px] text-fg-secondary">
              Answer a couple of quick questions and Earn will route this to the right path.
            </p>
          </div>
        </div>
      )}

      <FrontDoor />
    </div>
  );
}
