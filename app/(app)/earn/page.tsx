import { redirect } from "next/navigation";
import Link from "next/link";
import { getSessionContext } from "@/lib/auth";
import { FrontDoor } from "./FrontDoor";

export const dynamic = "force-dynamic";

// Earn — the front door. Earnest Fundmaker qualifies whoever lands and routes
// them into the right path. Microcopy per spec: "Earn" / "Ask Earn".
export default async function EarnPage() {
  const ctx = await getSessionContext();
  if (!ctx) redirect("/login");
  if (!ctx.orgId) redirect("/onboarding");

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

      <FrontDoor />
    </div>
  );
}
