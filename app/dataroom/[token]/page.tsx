import { createServiceClient } from "@/lib/supabase/server";
import { blendTrackRecord } from "@/lib/track-record";
import { DATA_ROOM_SECTIONS } from "@/lib/data-room";
import type {
  Organization,
  InvestmentThesis,
  TrackRecord,
  Entity,
  OrganizationMember,
  Principal,
  Document,
  DataRoomShare,
} from "@/lib/supabase/database.types";

// Public, read-only data room. Lives OUTSIDE the authed (app) group so it's
// reachable without a login. The token is the sole gate: the share row is
// resolved with the service-role client (RLS-bypassing) and only honored when
// it is not revoked and not past its expiry.
export const dynamic = "force-dynamic";

function compactUsd(n: number | null): string | null {
  if (n == null || n <= 0) return null;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(n);
}

function safeHref(url: string | null): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    if (u.protocol === "http:" || u.protocol === "https:") return u.href;
  } catch {
    /* not absolute */
  }
  return null;
}

function Unavailable() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-surface-0 px-6 text-center">
      <span className="font-mono text-[11px] uppercase tracking-[0.25em] text-gold-400">FundExecs OS</span>
      <h1 className="mt-3 font-display text-2xl font-semibold text-fg-primary">This data room isn&apos;t available</h1>
      <p className="mt-2 max-w-sm text-sm text-fg-secondary">
        The link is invalid, has expired, or has been revoked. Ask the sender for a fresh link.
      </p>
    </main>
  );
}

export default async function PublicDataRoom({ params }: { params: { token: string } }) {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return <Unavailable />;
  const supabase = createServiceClient();

  const { data: shareRow } = await supabase
    .from("data_room_shares")
    .select("*")
    .eq("token", params.token)
    .maybeSingle();
  const share = shareRow as DataRoomShare | null;
  if (!share || share.revoked_at) return <Unavailable />;
  if (share.expires_at && new Date(share.expires_at).getTime() < Date.now()) return <Unavailable />;

  const orgId = share.organization_id;
  const [orgRes, thesisRes, recordsRes, entitiesRes, membersRes, docsRes] = await Promise.all([
    supabase.from("organizations").select("*").eq("id", orgId).maybeSingle(),
    supabase
      .from("investment_theses")
      .select("*")
      .eq("organization_id", orgId)
      .order("is_active", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase.from("track_records").select("*").eq("organization_id", orgId).order("vintage_year", { ascending: false }),
    supabase.from("entities").select("*").eq("organization_id", orgId),
    supabase.from("organization_members").select("*").eq("organization_id", orgId),
    supabase.from("documents").select("*").eq("organization_id", orgId).order("sort_order", { ascending: true }),
  ]);

  const org = orgRes.data as Organization | null;
  if (!org) return <Unavailable />;
  const thesis = thesisRes.data as InvestmentThesis | null;
  const records = (recordsRes.data ?? []) as TrackRecord[];
  const entities = (entitiesRes.data ?? []) as Entity[];
  const members = (membersRes.data ?? []) as OrganizationMember[];
  const documents = (docsRes.data ?? []) as Document[];

  let principals: Principal[] = [];
  if (members.length) {
    const { data } = await supabase.from("principals").select("*").in("id", members.map((m) => m.principal_id));
    principals = (data ?? []) as Principal[];
  }
  const byId = new Map(principals.map((p) => [p.id, p]));
  const blended = blendTrackRecord(records);
  const accent = org.brand_color && /^#[0-9a-fA-F]{3,8}$/.test(org.brand_color) ? org.brand_color : "#D4AF6A";

  // Log the visit (fire-and-forget; never block the render).
  await supabase
    .from("data_room_views")
    .insert({ organization_id: orgId, share_id: share.id, kind: "room" })
    .then(() => undefined, () => undefined);

  const docsBySection = new Map<string, Document[]>();
  for (const d of documents) {
    const k = d.doc_type ?? "other";
    (docsBySection.get(k) ?? docsBySection.set(k, []).get(k)!).push(d);
  }

  return (
    <main className="min-h-screen bg-surface-0 text-fg-primary">
      <div className="mx-auto max-w-3xl px-6 py-12">
        <header className="mb-8 flex items-start gap-4 border-b pb-6" style={{ borderColor: `${accent}55` }}>
          <span
            className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg font-display text-xl font-semibold text-surface-0"
            style={{ backgroundColor: accent }}
          >
            {org.name.charAt(0).toUpperCase()}
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="font-mono text-[11px] uppercase tracking-[0.25em] text-gold-400">Data Room</span>
              <span className="rounded-full border border-line bg-surface-2 px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider text-fg-muted">
                Read-only
              </span>
            </div>
            <h1 className="mt-2 font-display text-3xl font-semibold tracking-tight">{org.name}</h1>
            {org.tagline ? <p className="mt-1 text-sm text-fg-secondary">{org.tagline}</p> : null}
          </div>
        </header>

        {blended.dealCount > 0 ? (
          <section className="mb-8">
            <h2 className="mb-3 font-mono text-xs uppercase tracking-wider text-fg-muted">Track Record</h2>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {[
                { v: blended.weightedGrossIrr != null ? `${blended.weightedGrossIrr.toFixed(0)}%` : "—", l: "Gross IRR" },
                { v: blended.pooledMoic != null ? `${blended.pooledMoic.toFixed(1)}x` : "—", l: "MOIC" },
                { v: blended.dpi != null ? `${blended.dpi.toFixed(2)}x` : "—", l: "DPI" },
                { v: compactUsd(blended.totalInvested) ?? "—", l: "Invested" },
              ].map((m) => (
                <div key={m.l} className="rounded-lg border border-line bg-surface-1 px-3 py-2.5 text-center">
                  <p className="font-display text-xl font-semibold">{m.v}</p>
                  <p className="mt-1 font-mono text-[9px] uppercase tracking-wider text-fg-muted">{m.l}</p>
                </div>
              ))}
            </div>
          </section>
        ) : null}

        {thesis ? (
          <section className="mb-8">
            <h2 className="mb-2 font-mono text-xs uppercase tracking-wider text-fg-muted">Thesis &amp; Strategy</h2>
            <p className="text-sm font-medium">{thesis.title}</p>
            {thesis.summary ? <p className="mt-1 text-sm leading-snug text-fg-secondary">{thesis.summary}</p> : null}
          </section>
        ) : null}

        {members.length > 0 ? (
          <section className="mb-8">
            <h2 className="mb-2 font-mono text-xs uppercase tracking-wider text-fg-muted">Team</h2>
            <div className="flex flex-wrap gap-2">
              {members.map((m) => {
                const p = byId.get(m.principal_id);
                const name = p?.full_name || p?.email || "Member";
                return (
                  <span key={m.id} className="rounded-full border border-line bg-surface-1 px-2.5 py-1 text-xs text-fg-secondary">
                    <span className="text-fg-primary">{name}</span>
                    {p?.title ? <span className="text-fg-muted"> · {p.title}</span> : null}
                  </span>
                );
              })}
            </div>
          </section>
        ) : null}

        {entities.length > 0 ? (
          <section className="mb-8">
            <h2 className="mb-2 font-mono text-xs uppercase tracking-wider text-fg-muted">Structure</h2>
            <p className="text-sm text-fg-secondary">{entities.map((e) => e.name).join("  ·  ")}</p>
          </section>
        ) : null}

        {documents.length > 0 ? (
          <section className="mb-8">
            <h2 className="mb-3 font-mono text-xs uppercase tracking-wider text-fg-muted">Documents</h2>
            <div className="flex flex-col gap-4">
              {DATA_ROOM_SECTIONS.map((s) => {
                const docs = docsBySection.get(s.key);
                if (!docs?.length) return null;
                return (
                  <div key={s.key}>
                    <p className="mb-1.5 font-mono text-[10px] uppercase tracking-wider text-gold-400">{s.label}</p>
                    <div className="flex flex-col gap-1.5">
                      {docs.map((d) => {
                        const href = safeHref(d.storage_key);
                        return (
                          <div key={d.id} className="rounded-lg border border-line bg-surface-1 px-3 py-2">
                            <div className="flex items-center gap-3">
                              <span className="min-w-0 flex-1 truncate text-sm text-fg-primary">{d.name}</span>
                              {href ? (
                                <a
                                  href={`/dataroom/${params.token}/d/${d.id}`}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="font-mono text-[10px] uppercase tracking-wider text-gold-400 hover:underline"
                                >
                                  Open →
                                </a>
                              ) : null}
                            </div>
                            {d.content ? (
                              <p className="mt-1 whitespace-pre-wrap text-xs leading-snug text-fg-secondary">{d.content}</p>
                            ) : null}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
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
