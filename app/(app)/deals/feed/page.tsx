import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionContext } from "@/lib/auth";
import { createServerClient } from "@/lib/supabase/server";
import { getDealFeed } from "@/lib/deal-share.server";
import { DealsSeen } from "@/components/inbox/DealsSeen";
import { DealSignalFeed } from "@/components/intelligence/DealSignalFeed";
import { SectorHeatmap } from "@/components/intelligence/SectorHeatmap";
import { buildHeatmap } from "@/lib/deal-intelligence";
import type { DealSignal } from "@/lib/deal-intelligence";

export const dynamic = "force-dynamic";

// "Deals that fit you" — the pull feed counterpart to the bell alert. Deals
// shared across the ecosystem that matched one of this org's investor profiles
// (AngelList-style: check size, stage, sector, geography), strongest fit first.
// Each opens the confidential teaser; the full room comes on request.
export default async function DealFeedPage() {
  const ctx = await getSessionContext();
  if (!ctx) redirect("/login");
  if (!ctx.orgId) redirect("/onboarding");

  const supabase = createServerClient();

  const [items, dealsRes] = await Promise.all([
    getDealFeed(ctx.orgId),
    supabase
      .from("deals")
      .select("id, name, geography, asset_class, stage, target_amount, created_at, source")
      .eq("organization_id", ctx.orgId)
      .order("created_at", { ascending: false })
      .limit(100),
  ]);

  // Map external/demo deals into DealSignal shape for the intelligence feed.
  // AI-drafted pipeline items (source === "Copilot") are intentionally excluded:
  // they represent internal work product, not ecosystem signals, and showing
  // them here creates a confusing mix of "my deals" and "market intelligence."
  const INTERNAL_SOURCES = new Set(["Copilot", "copilot"]);
  const signals: DealSignal[] = (dealsRes.data ?? [])
    .filter((d) => !INTERNAL_SOURCES.has(d.source ?? ""))
    .map((d) => ({
      id: d.id,
      signalType: "funding_round" as const,
      title: d.name ?? "Unnamed Deal",
      sector: d.asset_class ?? undefined,
      geography: d.geography ?? undefined,
      dealStage: d.stage ?? undefined,
      dealSizeMin: null,
      dealSizeMax: d.target_amount ?? null,
      relevanceScore: 75,
      thesisMatchScore: 65,
      publishedAt: d.created_at,
    }));

  const heatmapCells = buildHeatmap(signals);
  const sectors = [...new Set(heatmapCells.map((c) => c.sector))];
  const stages = [...new Set(heatmapCells.map((c) => c.stage))];

  return (
    <div className="fx-ambient mx-auto max-w-4xl">
      {/* Opening the feed clears the lightbulb's unread badge. */}
      <DealsSeen />
      <header className="mb-8">
        <span className="font-mono text-[11px] uppercase tracking-[0.25em] text-gold-400">
          Ecosystem
        </span>
        <h1 className="mt-2 font-display text-3xl font-semibold tracking-tight text-fg-primary">
          Deals that fit you
        </h1>
        <p className="mt-2 max-w-prose text-sm text-fg-secondary">
          Deals shared across the ecosystem that match your investor mandate — check size, stage,
          sector, and geography. Open the teaser; request the full room when it fits.
        </p>
      </header>

      {items.length === 0 ? (
        <p className="fx-card border-dashed p-8 text-center text-sm text-fg-muted">
          No matching deals yet. When a member shares a deal that fits one of your investor
          profiles, it lands here — and pings your bell.
        </p>
      ) : (
        <ul className="flex flex-col gap-3">
          {items.map((d) => {
            const facets = [d.stage, d.sector, d.geography, d.amount].filter(Boolean).join(" · ");
            return (
              <li key={d.recipientId}>
                <Link
                  href={`/d/${d.token}`}
                  className="fx-card fx-card-hover group block p-4"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-fg-primary">{d.dealName}</p>
                      <p className="mt-0.5 text-xs capitalize text-fg-secondary">{facets}</p>
                      <p className="mt-2 line-clamp-2 text-xs leading-snug text-fg-muted">
                        {d.memo}
                      </p>
                    </div>
                    <span className="shrink-0 rounded-full border border-gold-500/30 bg-gold-500/10 px-2 py-0.5 font-mono text-[10px] text-gold-300">
                      {d.score}/100
                    </span>
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}

      {signals.length > 0 && (
        <section className="mt-12">
          <header className="mb-6">
            <span className="font-mono text-[11px] uppercase tracking-[0.25em] text-gold-400">
              Intelligence
            </span>
            <h2 className="mt-1 font-display text-2xl font-semibold tracking-tight text-fg-primary">
              Deal Signal Feed
            </h2>
            <p className="mt-1 text-sm text-fg-secondary">
              Live deal signals across sectors — funding rounds, acquisitions, and market moves mapped to your thesis.
            </p>
          </header>
          <DealSignalFeed signals={signals} />
        </section>
      )}

      {heatmapCells.length > 0 && (
        <section className="mt-12">
          <header className="mb-6">
            <span className="font-mono text-[11px] uppercase tracking-[0.25em] text-gold-400">
              Intelligence
            </span>
            <h2 className="mt-1 font-display text-2xl font-semibold tracking-tight text-fg-primary">
              Sector Heatmap
            </h2>
            <p className="mt-1 text-sm text-fg-secondary">
              Activity intensity by sector and stage — darker cells indicate higher deal velocity.
            </p>
          </header>
          <SectorHeatmap cells={heatmapCells} sectors={sectors} stages={stages} />
        </section>
      )}
    </div>
  );
}
