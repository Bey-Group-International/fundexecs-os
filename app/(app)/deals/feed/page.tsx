import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionContext } from "@/lib/auth";
import { getDealFeed } from "@/lib/deal-share.server";
import { DealsSeen } from "@/components/inbox/DealsSeen";

export const dynamic = "force-dynamic";

// "Deals that fit you" — the pull feed counterpart to the bell alert. Deals
// shared across the ecosystem that matched one of this org's investor profiles
// (AngelList-style: check size, stage, sector, geography), strongest fit first.
// Each opens the confidential teaser; the full room comes on request.
export default async function DealFeedPage() {
  const ctx = await getSessionContext();
  if (!ctx) redirect("/login");
  if (!ctx.orgId) redirect("/onboarding");

  const items = await getDealFeed(ctx.orgId);

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
    </div>
  );
}
