import { createServiceClient, hasSupabaseServiceEnv } from "@/lib/supabase/server";
import { dealTeaser } from "@/lib/deal-share";
import { logDealShareView } from "@/lib/deal-share.server";
import type { Deal, DealShare } from "@/lib/supabase/database.types";

// Public, read-only teaser for a shared deal. Lives OUTSIDE the authed (app)
// group so it opens without a login. Resolves the share by token with the
// service-role client and exposes ONLY the confidential teaser (memo + a few
// non-sensitive facets) — never the deal room, notes, or source. Each open is
// logged for the sharer's tracked-link analytics.
export const dynamic = "force-dynamic";

function Unavailable() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-surface-0 px-6 text-center">
      <span className="font-mono text-[11px] uppercase tracking-[0.25em] text-gold-400">
        FundExecs OS
      </span>
      <h1 className="mt-3 font-display text-2xl font-semibold text-fg-primary">
        This link isn&apos;t available
      </h1>
      <p className="mt-2 max-w-sm text-sm text-fg-secondary">
        The deal link is invalid or has been revoked. Ask the sender for a fresh link.
      </p>
    </main>
  );
}

export default async function SharedDealPage(props: { params: Promise<{ token: string }> }) {
  const params = await props.params;
  // No service role key (e.g. a preview without secrets) — fail closed.
  if (!hasSupabaseServiceEnv()) return <Unavailable />;

  const supabase = createServiceClient();

  const { data: shareRow } = await supabase
    .from("deal_shares")
    .select("*")
    .eq("token", params.token)
    .maybeSingle();
  const share = shareRow as DealShare | null;
  if (!share || share.revoked_at) return <Unavailable />;

  const { data: dealRow } = await supabase
    .from("deals")
    .select("id, name, stage, asset_class, geography, target_amount")
    .eq("id", share.deal_id)
    .maybeSingle();
  const deal = dealRow as Deal | null;
  if (!deal) return <Unavailable />;

  const { data: orgRow } = await supabase
    .from("organizations")
    .select("name")
    .eq("id", share.organization_id)
    .maybeSingle();
  const sharer = (orgRow as { name: string } | null)?.name ?? "A FundExecs OS member";

  // Track the open (best-effort; never blocks the render).
  await logDealShareView(params.token);

  const t = dealTeaser(deal);
  const facets: { label: string; value: string }[] = [
    { label: "Stage", value: t.stage },
    { label: "Sector", value: t.sector },
  ];
  if (t.geography) facets.push({ label: "Geography", value: t.geography });
  if (t.amount) facets.push({ label: "Target allocation", value: t.amount });

  return (
    <main className="fx-ambient mx-auto flex min-h-screen max-w-2xl flex-col justify-center px-6 py-16">
      <span className="font-mono text-[11px] uppercase tracking-[0.25em] text-gold-400">
        Confidential deal teaser · FundExecs OS
      </span>
      <h1 className="mt-3 font-display text-3xl font-semibold tracking-tight text-fg-primary">
        {t.name}
      </h1>
      <p className="mt-1 text-sm text-fg-secondary">Shared by {sharer}</p>

      <dl className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {facets.map((f) => (
          <div key={f.label} className="fx-card p-3">
            <dt className="font-mono text-[10px] uppercase tracking-widest text-fg-muted">
              {f.label}
            </dt>
            <dd className="mt-1 text-sm font-medium capitalize text-fg-primary">{f.value}</dd>
          </div>
        ))}
      </dl>

      <div className="fx-card mt-6 p-5">
        <p className="font-mono text-[10px] uppercase tracking-widest text-gold-400">The teaser</p>
        <p className="mt-2 text-sm leading-relaxed text-fg-secondary">{share.memo}</p>
      </div>

      <p className="mt-6 text-xs leading-snug text-fg-muted">
        This is a confidential summary. The full deal room — underwriting, diligence, and
        documents — opens only to qualified investors on request. Reply to the sender to request
        access.
      </p>
    </main>
  );
}
