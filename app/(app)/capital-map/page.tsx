import { redirect } from "next/navigation";
import { getSessionContext } from "@/lib/auth";
import { createServerClient } from "@/lib/supabase/server";
import { buildCapitalMap } from "@/lib/capital-map";
import { CapitalMap } from "./CapitalMap";

export const dynamic = "force-dynamic";

// The Capital Map — your network as a live map of capital. Relationship
// temperature, thesis fit, warm-intro paths, and gated next actions, assembled
// from the first-party investors / commitments / relationships / thesis tables.
export default async function CapitalMapPage() {
  const ctx = await getSessionContext();
  if (!ctx) redirect("/login");
  if (!ctx.orgId) redirect("/onboarding");

  const supabase = createServerClient();
  const entries = await buildCapitalMap(supabase);

  return (
    <div className="mx-auto max-w-5xl">
      <header className="mb-6">
        <span className="font-mono text-[11px] uppercase tracking-[0.25em] text-gold-400">
          Capital Map
        </span>
        <h1 className="mt-2 font-display text-3xl font-semibold tracking-tight text-fg-primary">
          Turn your network into a capital map
        </h1>
        <p className="mt-1 text-sm text-fg-secondary">
          Every investor scored by temperature and thesis fit, with the warm path
          in and the next move — each routed through the gate so nothing reaches a
          counterparty without your sign-off.
        </p>
      </header>

      <CapitalMap entries={entries} />
    </div>
  );
}
