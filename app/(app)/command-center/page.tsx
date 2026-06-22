import { redirect } from "next/navigation";
import { getSessionContext } from "@/lib/auth";
import { CommandCenter } from "@/components/CommandCenter";

export const dynamic = "force-dynamic";

export default async function CommandCenterPage() {
  const ctx = await getSessionContext();
  if (!ctx) redirect("/login");
  if (!ctx.orgId) redirect("/onboarding");

  return (
    <div className="fx-ambient mx-auto max-w-5xl">
      <header className="mb-6">
        <span className="font-mono text-[11px] uppercase tracking-[0.25em] text-gold-400">
          Command Center
        </span>
        <h1 className="mt-2 font-display text-3xl font-semibold tracking-tight text-fg-primary">
          Mission Control
        </h1>
        <p className="mt-1 text-sm text-fg-secondary">
          Relationship intelligence, next-best actions, and the signals that need your attention
          — assembled and prioritized by your AI team.
        </p>
      </header>

      <CommandCenter />
    </div>
  );
}
