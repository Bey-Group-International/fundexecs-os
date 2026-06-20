import { redirect } from "next/navigation";
import { getSessionContext } from "@/lib/auth";
import { getAgenda } from "@/lib/agenda";
import { AgendaBoard } from "@/components/agenda/AgendaBoard";

export const dynamic = "force-dynamic";

export default async function AgendaPage() {
  const ctx = await getSessionContext();
  if (!ctx) redirect("/login");
  if (!ctx.orgId) redirect("/onboarding");

  const agenda = await getAgenda(ctx.orgId);

  return (
    <div className="mx-auto max-w-4xl">
      <header className="mb-6">
        <span className="font-mono text-[11px] uppercase tracking-[0.25em] text-gold-400">
          Agenda
        </span>
        <h1 className="mt-2 font-display text-3xl font-semibold tracking-tight text-fg-primary">
          Every deadline in one place
        </h1>
        <p className="mt-1 text-sm text-fg-secondary">
          Every dated obligation across diligence, capital, and deals — ordered
          by urgency so nothing slips.
        </p>
      </header>

      <AgendaBoard agenda={agenda} />
    </div>
  );
}
