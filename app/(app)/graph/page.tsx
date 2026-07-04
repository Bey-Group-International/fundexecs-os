import { redirect } from "next/navigation";
import { getSessionContext } from "@/lib/auth";
import { createServerClient } from "@/lib/supabase/server";
import { buildGraph } from "@/lib/graph";
import type { GraphData } from "@/lib/graph";
import type { GraphKind } from "@/lib/supabase/database.types";
import { GraphExplorer } from "./GraphExplorer";

export const dynamic = "force-dynamic";

// The three-graph explorer. Renders server-side by assembling all three graphs
// directly (same lib/graph logic the /api/graph route uses), then hands them to
// a client component that toggles between them and draws a radial SVG layout.
export default async function GraphPage() {
  const ctx = await getSessionContext();
  if (!ctx) redirect("/login");
  if (!ctx.orgId) redirect("/onboarding");

  const supabase = await createServerClient();
  const [relationship, deal, capital] = await Promise.all([
    buildGraph(supabase, "relationship"),
    buildGraph(supabase, "deal"),
    buildGraph(supabase, "capital"),
  ]);

  const graphs: Record<GraphKind, GraphData> = { relationship, deal, capital };

  return (
    <div className="fx-ambient mx-auto max-w-5xl">
      <header className="mb-6 animate-fade-up">
        <span className="inline-flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.25em] text-gold-400">
          <span className="h-1.5 w-1.5 rounded-full bg-gold-400 shadow-[0_0_10px_2px_rgba(212,175,106,0.6)]" />
          Graphs
        </span>
        <h1 className="mt-2 font-display text-3xl font-semibold tracking-tight text-fg-primary">
          The Three Graphs
        </h1>
        <p className="mt-1 max-w-2xl text-sm leading-relaxed text-fg-secondary">
          Relationship, Deal, and Capital — the connective tissue of your
          private-markets operation. Hover any node to trace its neighborhood.
        </p>
      </header>

      <GraphExplorer graphs={graphs} />
    </div>
  );
}
