import { createServiceClient } from "@/lib/supabase/server";
import { rollupCapTable } from "@/lib/cap-table";
import { compactUsd, usd, multiple, shortDate } from "@/lib/format";
import type {
  Organization,
  Investor,
  Commitment,
  Fund,
  Asset,
  CapitalEvent,
  InvestorPortalShare,
} from "@/lib/supabase/database.types";

// Public, read-only investor portal. Lives OUTSIDE the authed (app) group so
// it's reachable without a login. The token is the sole gate: the share row is
// resolved with the service-role client (RLS-bypassing) and only honored when
// it is not revoked and not past its expiry. Native — no external dependency.
export const dynamic = "force-dynamic";

const HELD_OUT = new Set(["exited", "sold", "realized", "divested", "written_off"]);

function Unavailable() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-surface-0 px-6 text-center">
      <span className="font-mono text-[11px] uppercase tracking-[0.25em] text-gold-400">FundExecs OS</span>
      <h1 className="mt-3 font-display text-2xl font-semibold text-fg-primary">This statement isn&apos;t available</h1>
      <p className="mt-2 max-w-sm text-sm text-fg-secondary">
        The link is invalid, has expired, or has been revoked. Ask the sender for a fresh link.
      </p>
    </main>
  );
}

function Stat({ value, label, tone }: { value: string; label: string; tone?: string }) {
  return (
    <div className="rounded-lg border border-line bg-surface-1 px-3 py-2.5 text-center">
      <p className={`font-display text-xl font-semibold ${tone ?? "text-fg-primary"}`}>{value}</p>
      <p className="mt-1 font-mono text-[9px] uppercase tracking-wider text-fg-muted">{label}</p>
    </div>
  );
}

export default async function InvestorPortal({ params }: { params: { token: string } }) {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return <Unavailable />;
  const supabase = createServiceClient();

  const { data: shareRow } = await supabase
    .from("investor_portal_shares")
    .select("*")
    .eq("token", params.token)
    .maybeSingle();
  const share = shareRow as InvestorPortalShare | null;
  if (!share || share.revoked_at) return <Unavailable />;
  if (share.expires_at && new Date(share.expires_at).getTime() < Date.now()) return <Unavailable />;

  const orgId = share.organization_id;
  const [orgRes, investorsRes, commitRes, fundRes, assetRes, eventsRes] = await Promise.all([
    supabase.from("organizations").select("*").eq("id", orgId).maybeSingle(),
    supabase.from("investors").select("*").eq("organization_id", orgId),
    supabase.from("commitments").select("*").eq("organization_id", orgId),
    supabase.from("funds").select("*").eq("organization_id", orgId),
    supabase.from("assets").select("current_value,status").eq("organization_id", orgId),
    supabase
      .from("capital_events")
      .select("*")
      .eq("organization_id", orgId)
      .eq("investor_id", share.investor_id)
      .order("effective_date", { ascending: false })
      .limit(50),
  ]);

  const org = orgRes.data as Organization | null;
  const investor = (investorsRes.data ?? []).find((i) => (i as Investor).id === share.investor_id) as
    | Investor
    | undefined;
  if (!org || !investor) return <Unavailable />;

  const assets = (assetRes.data ?? []) as Pick<Asset, "current_value" | "status">[];
  const totalNav = assets
    .filter((a) => !HELD_OUT.has((a.status ?? "").toLowerCase()))
    .reduce((s, a) => s + (typeof a.current_value === "number" ? a.current_value : 0), 0);

  const capTable = rollupCapTable(
    (commitRes.data ?? []) as Commitment[],
    (investorsRes.data ?? []) as Investor[],
    (fundRes.data ?? []) as Fund[],
    totalNav,
  );
  const account = capTable.holders.find((h) => h.investorId === share.investor_id);
  if (!account) return <Unavailable />;

  const events = (eventsRes.data ?? []) as CapitalEvent[];
  const accent = org.brand_color && /^#[0-9a-fA-F]{3,8}$/.test(org.brand_color) ? org.brand_color : "#D4AF6A";

  // Log the visit (fire-and-forget; never block the render).
  await supabase
    .from("investor_portal_views")
    .insert({ organization_id: orgId, share_id: share.id })
    .then(() => undefined, () => undefined);

  return (
    <main className="min-h-screen bg-surface-0 text-fg-primary">
      <div className="mx-auto max-w-2xl px-6 py-12">
        <header className="mb-8 flex items-start gap-4 border-b pb-6" style={{ borderColor: `${accent}55` }}>
          <span
            className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg font-display text-xl font-semibold text-surface-0"
            style={{ backgroundColor: accent }}
          >
            {org.name.charAt(0).toUpperCase()}
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="font-mono text-[11px] uppercase tracking-[0.25em] text-gold-400">Investor Portal</span>
              <span className="rounded-full border border-line bg-surface-2 px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider text-fg-muted">
                Read-only
              </span>
            </div>
            <h1 className="mt-2 font-display text-2xl font-semibold tracking-tight">{org.name}</h1>
            <p className="mt-1 text-sm text-fg-secondary">
              Capital account · <span className="text-fg-primary">{investor.name}</span>
            </p>
          </div>
        </header>

        {/* Capital account */}
        <section className="mb-8">
          <h2 className="mb-3 font-mono text-xs uppercase tracking-wider text-fg-muted">Capital account</h2>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Stat value={usd(account.committed)} label="Committed" />
            <Stat value={usd(account.called)} label="Called" />
            <Stat value={usd(account.unfunded)} label="Unfunded" />
            <Stat value={usd(account.distributed)} label="Distributed" />
          </div>
          <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Stat value={`${account.ownershipPct}%`} label="Ownership" tone="text-gold-300" />
            <Stat value={usd(account.navShare)} label="NAV" />
            <Stat value={multiple(account.dpi)} label="DPI" />
            <Stat
              value={multiple(account.tvpi)}
              label="TVPI"
              tone={account.tvpi != null && account.tvpi >= 1 ? "text-emerald-300" : undefined}
            />
          </div>
        </section>

        {/* Capital flows */}
        {events.length > 0 ? (
          <section className="mb-8">
            <h2 className="mb-3 font-mono text-xs uppercase tracking-wider text-fg-muted">Capital flows</h2>
            <div className="overflow-hidden rounded-lg border border-line">
              {events.map((e, i) => (
                <div
                  key={e.id}
                  className={`flex items-center justify-between gap-3 bg-surface-1 px-3 py-2.5 text-sm ${i > 0 ? "border-t border-line/50" : ""}`}
                >
                  <span className="font-mono text-[11px] text-fg-muted">{shortDate(e.effective_date)}</span>
                  <span className="flex-1 truncate text-fg-secondary">{e.event_type.replace(/_/g, " ")}</span>
                  <span className="font-mono text-fg-primary">{compactUsd(typeof e.amount === "number" ? e.amount : 0)}</span>
                </div>
              ))}
            </div>
          </section>
        ) : null}

        <footer className="mt-12 border-t border-line pt-6 text-center">
          <span className="font-mono text-[10px] uppercase tracking-[0.25em] text-fg-muted">Powered by FundExecs OS</span>
        </footer>
      </div>
    </main>
  );
}
