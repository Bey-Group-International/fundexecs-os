import { redirect } from "next/navigation";
import Link from "next/link";
import { getSessionContext } from "@/lib/auth";
import { createServerClient } from "@/lib/supabase/server";
import type {
  Organization,
  InvestmentThesis,
  TrackRecord,
  Entity,
  OrganizationMember,
  Principal,
  Document,
  DataRoomShare,
  DataRoomView,
} from "@/lib/supabase/database.types";
import { blendTrackRecord } from "@/lib/track-record";
import { computeBuildReadiness } from "@/lib/build-readiness";
import { DATA_ROOM_SECTIONS, summarizeDataRoom } from "@/lib/data-room";
import { PrintButton } from "./PrintButton";
import { ShareControls } from "./ShareControls";
import { DeleteDocumentButton } from "./DeleteDocumentButton";
import { openSection } from "./materials-actions";

// Render a stored document link only when it is a real http(s) URL.
function safeHref(url: string | null): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    if (u.protocol === "http:" || u.protocol === "https:") return u.href;
  } catch {
    /* not an absolute URL */
  }
  return null;
}

function compactUsd(n: number | null): string | null {
  if (n == null || n <= 0) return null;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(n);
}

function Metric({ value, label }: { value: string; label: string }) {
  return (
    <div className="rounded-lg border border-line bg-surface-0 px-3 py-2.5 text-center print:border-neutral-300 print:bg-white">
      <p className="font-display text-xl font-semibold leading-none text-fg-primary print:text-black">
        {value}
      </p>
      <p className="mt-1 font-mono text-[9px] uppercase tracking-wider text-fg-muted print:text-neutral-500">
        {label}
      </p>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-5">
      <h3 className="mb-2 font-mono text-[10px] uppercase tracking-[0.2em] text-gold-500 print:text-neutral-600">
        {title}
      </h3>
      {children}
    </section>
  );
}

// Materials & Data Room: the firm's whole Build foundation — identity, thesis,
// pooled track record, structure, team — assembled into a single branded,
// print-ready set of materials LPs can review. The foundation entered once
// compounds into the materials a prospective investor actually reads.
export async function MaterialsModule() {
  const ctx = await getSessionContext();
  if (!ctx?.orgId) redirect("/login");
  const supabase = createServerClient();

  // Single pass over the foundation tables — reused for both the rendered
  // materials and the readiness scoring (computeBuildReadiness), so the module
  // no longer double-fetches via getBuildReadiness.
  const [orgRes, thesesRes, recordsRes, entitiesRes, membersRes, docsRes, sharesRes, viewsRes] =
    await Promise.all([
      supabase.from("organizations").select("*").eq("id", ctx.orgId).maybeSingle(),
      supabase
        .from("investment_theses")
        .select("*")
        .eq("organization_id", ctx.orgId)
        .order("is_active", { ascending: false })
        .order("created_at", { ascending: false }),
      supabase
        .from("track_records")
        .select("*")
        .eq("organization_id", ctx.orgId)
        .order("vintage_year", { ascending: false }),
      supabase.from("entities").select("*").eq("organization_id", ctx.orgId),
      supabase.from("organization_members").select("*").eq("organization_id", ctx.orgId),
      supabase
        .from("documents")
        .select("*")
        .eq("organization_id", ctx.orgId)
        .order("sort_order", { ascending: true })
        .order("created_at", { ascending: true }),
      supabase
        .from("data_room_shares")
        .select("*")
        .eq("organization_id", ctx.orgId)
        .order("created_at", { ascending: false }),
      supabase
        .from("data_room_views")
        .select("*")
        .eq("organization_id", ctx.orgId)
        .order("created_at", { ascending: false })
        .limit(100),
    ]);

  const org = orgRes.data as Organization | null;
  const theses = (thesesRes.data ?? []) as InvestmentThesis[];
  const thesis = theses.find((t) => t.is_active) ?? theses[0] ?? null;
  const records = (recordsRes.data ?? []) as TrackRecord[];
  const entities = (entitiesRes.data ?? []) as Entity[];
  const members = (membersRes.data ?? []) as OrganizationMember[];
  const documents = (docsRes.data ?? []) as Document[];
  const shares = (sharesRes.data ?? []) as DataRoomShare[];
  const views = (viewsRes.data ?? []) as DataRoomView[];

  let principals: Principal[] = [];
  if (members.length) {
    const { data } = await supabase
      .from("principals")
      .select("*")
      .in("id", members.map((m) => m.principal_id));
    principals = (data ?? []) as Principal[];
  }
  const byId = new Map(principals.map((p) => [p.id, p]));

  const readiness = computeBuildReadiness({ org, theses, entities, records, members, principals });
  const docsBySection = new Map<string, Document[]>();
  for (const d of documents) {
    const k = d.doc_type ?? "other";
    const bucket = docsBySection.get(k);
    if (bucket) bucket.push(d);
    else docsBySection.set(k, [d]);
  }
  const docCounts: Record<string, number> = {};
  for (const [k, v] of docsBySection) docCounts[k] = v.length;
  const summary = summarizeDataRoom(readiness.statuses, docCounts);

  const roomOpens = views.filter((v) => v.kind === "room").length;
  const docOpens = views.filter((v) => v.kind === "document").length;
  const lastViewed = views[0]?.created_at
    ? new Date(views[0].created_at).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })
    : "—";

  const blended = blendTrackRecord(records);
  const accent = org?.brand_color && /^#[0-9a-fA-F]{3,8}$/.test(org.brand_color) ? org.brand_color : null;

  const checkSize = [compactUsd(thesis?.check_size_min ?? null), compactUsd(thesis?.check_size_max ?? null)].filter(
    Boolean,
  );

  return (
    <div>
      {/* Toolbar — hidden in print */}
      <div className="mb-5 flex items-center justify-between gap-4 print:hidden">
        <div>
          <h2 className="font-display text-xl font-semibold tracking-tight text-fg-primary">
            Materials &amp; Data Room
          </h2>
          <p className="mt-0.5 text-sm text-fg-secondary">
            Your foundation, assembled into investor-ready materials you can send.{" "}
            <span className="text-fg-muted">{readiness.overall}% complete.</span>
          </p>
        </div>
        <PrintButton />
      </div>

      {readiness.nextAction ? (
        <Link
          href={readiness.nextAction.href}
          className="mb-5 flex items-center gap-2 rounded-lg border border-gold-500/30 bg-gold-500/5 px-3 py-2 text-xs text-fg-secondary transition hover:bg-gold-500/10 print:hidden"
        >
          <span className="font-mono text-[9px] uppercase tracking-wider text-gold-400">
            Make it stronger
          </span>
          <span className="truncate text-fg-primary">{readiness.nextAction.label}</span>
          <span className="ml-auto text-gold-400">→</span>
        </Link>
      ) : null}

      {/* Data-room coverage checklist (operator aid; hidden in print) */}
      <div className="mb-6 rounded-2xl border border-line bg-surface-1 p-5 print:hidden">
        <div className="mb-3 flex items-center justify-between gap-3">
          <div>
            <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-gold-400">
              Institutional coverage
            </span>
            <p className="mt-0.5 text-sm text-fg-secondary">
              The sections an allocator&apos;s diligence team expects in an institutional fund data room.
            </p>
          </div>
          <div className="text-right">
            <span className="font-display text-2xl font-semibold text-fg-primary">{summary.weightedPercent}%</span>
            <p className="font-mono text-[9px] uppercase tracking-wider text-fg-muted">weighted</p>
          </div>
        </div>
        <p className="mb-3 text-xs text-fg-muted">
          Click a section to open its builder — write it manually, compose from your data, or draft with Earn.
        </p>
        <div className="flex flex-col gap-2">
          {summary.items.map((item) => {
            const docs = docsBySection.get(item.key) ?? [];
            return (
              <div key={item.key} className="overflow-hidden rounded-lg border border-line bg-surface-0">
                <form action={openSection} className="flex w-full items-center gap-2 px-3 py-2">
                  <input type="hidden" name="section" value={item.key} />
                  <span className={`font-mono text-xs ${item.ready ? "text-emerald-400" : "text-fg-muted"}`}>
                    {item.ready ? "✓" : "○"}
                  </span>
                  <span className={`text-sm ${item.ready ? "text-fg-primary" : "text-fg-secondary"}`}>
                    {item.label}
                  </span>
                  <span className="ml-auto font-mono text-[10px] uppercase tracking-wider text-fg-muted">
                    {item.docCount > 0
                      ? `${item.docCount} doc${item.docCount > 1 ? "s" : ""}`
                      : item.viaBuild
                        ? "from Build"
                        : "missing"}
                  </span>
                  <button
                    type="submit"
                    className="shrink-0 rounded-md border border-gold-500/40 bg-gold-500/10 px-2 py-1 font-mono text-[10px] uppercase tracking-wider text-gold-300 transition hover:bg-gold-500/20"
                  >
                    {docs.length ? "Open →" : "+ Build"}
                  </button>
                </form>
                {docs.length > 0 ? (
                  <div className="flex flex-col gap-1 border-t border-line/60 px-3 py-1.5">
                    {docs.map((d) => (
                      <div key={d.id} className="flex items-center gap-2">
                        <Link
                          href={`/document/${d.id}`}
                          className="flex min-w-0 flex-1 items-center gap-2 truncate text-sm text-fg-secondary transition hover:text-gold-300"
                        >
                          <span aria-hidden className="font-mono text-[11px] text-fg-muted">
                            {d.storage_key ? "🔗" : "📄"}
                          </span>
                          <span className="truncate">{d.name}</span>
                        </Link>
                        <DeleteDocumentButton id={d.id} name={d.name} />
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
        {summary.suggestions.length > 0 ? (
          <form action={openSection} className="mt-3 flex items-center gap-2 rounded-lg border border-gold-500/30 bg-gold-500/5 px-3 py-2">
            <input type="hidden" name="section" value={summary.suggestions[0].key} />
            <span className="font-mono text-[9px] uppercase tracking-wider text-gold-400">Next best to add</span>
            <span className="truncate text-sm text-fg-primary">{summary.suggestions[0].suggestion}</span>
            <button type="submit" className="ml-auto shrink-0 font-mono text-[10px] uppercase tracking-wider text-gold-400 hover:underline">
              Build →
            </button>
          </form>
        ) : null}
      </div>

      {/* The sheet */}
      <article className="mx-auto max-w-2xl rounded-2xl border border-line bg-surface-1 p-8 print:max-w-none print:rounded-none print:border-0 print:bg-white print:p-0 print:text-black">
        {/* Identity header */}
        <header
          className="flex items-start gap-4 border-b pb-5"
          style={{ borderColor: accent ? `${accent}55` : undefined }}
        >
          {org?.logo_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={org.logo_url}
              alt=""
              className="h-12 w-12 shrink-0 rounded-lg object-contain"
            />
          ) : (
            <span
              className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg font-display text-xl font-semibold text-surface-0"
              style={{ backgroundColor: accent ?? "#D4AF6A" }}
            >
              {(org?.name ?? "F").charAt(0).toUpperCase()}
            </span>
          )}
          <div className="min-w-0 flex-1">
            <h1 className="font-display text-2xl font-semibold tracking-tight text-fg-primary print:text-black">
              {org?.name ?? "Your Firm"}
            </h1>
            {org?.tagline ? (
              <p className="mt-0.5 text-sm text-fg-secondary print:text-neutral-700">{org.tagline}</p>
            ) : null}
            <p className="mt-1.5 font-mono text-[10px] uppercase tracking-wider text-fg-muted print:text-neutral-500">
              {[org?.entity_type, org?.jurisdiction, org?.website].filter(Boolean).join("  ·  ") || "—"}
            </p>
          </div>
        </header>

        {/* Pooled track record */}
        <Section title="Track Record">
          {blended.dealCount > 0 ? (
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <Metric
                value={blended.weightedGrossIrr != null ? `${blended.weightedGrossIrr.toFixed(0)}%` : "—"}
                label="Gross IRR"
              />
              <Metric
                value={blended.pooledMoic != null ? `${blended.pooledMoic.toFixed(1)}x` : "—"}
                label="MOIC"
              />
              <Metric value={blended.dpi != null ? `${blended.dpi.toFixed(2)}x` : "—"} label="DPI" />
              <Metric value={compactUsd(blended.totalInvested) ?? "—"} label="Invested" />
            </div>
          ) : (
            <p className="text-sm text-fg-muted print:text-neutral-500">
              No track record captured yet.
            </p>
          )}
          {blended.dealCount > 0 ? (
            <p className="mt-2 font-mono text-[10px] uppercase tracking-wider text-fg-muted print:text-neutral-500">
              {blended.dealCount} deals · {blended.realizedCount} realized
              {blended.vintageRange
                ? ` · vintages ${blended.vintageRange.from}–${blended.vintageRange.to}`
                : ""}
            </p>
          ) : null}
        </Section>

        {/* Thesis */}
        {thesis ? (
          <Section title="Investment Thesis">
            <p className="text-sm font-medium text-fg-primary print:text-black">{thesis.title}</p>
            {thesis.summary ? (
              <p className="mt-1 text-sm leading-snug text-fg-secondary print:text-neutral-700">
                {thesis.summary}
              </p>
            ) : null}
            <p className="mt-2 font-mono text-[10px] uppercase tracking-wider text-fg-muted print:text-neutral-500">
              {[
                thesis.asset_classes?.join(", "),
                thesis.geographies?.join(", "),
                checkSize.length ? checkSize.join("–") : null,
                thesis.target_irr != null ? `${thesis.target_irr}% target IRR` : null,
                thesis.target_moic != null ? `${thesis.target_moic}x target MOIC` : null,
              ]
                .filter(Boolean)
                .join("  ·  ") || "—"}
            </p>
          </Section>
        ) : null}

        {/* Team */}
        {members.length > 0 ? (
          <Section title="Team">
            <div className="flex flex-wrap gap-2">
              {members.map((m) => {
                const p = byId.get(m.principal_id);
                const name = p?.full_name || p?.email || "Member";
                return (
                  <span
                    key={m.id}
                    className="rounded-full border border-line bg-surface-0 px-2.5 py-1 text-xs text-fg-secondary print:border-neutral-300 print:bg-white print:text-neutral-700"
                  >
                    <span className="text-fg-primary print:text-black">{name}</span>
                    {p?.title ? <span className="text-fg-muted print:text-neutral-500"> · {p.title}</span> : null}
                  </span>
                );
              })}
            </div>
          </Section>
        ) : null}

        {/* Structure */}
        {entities.length > 0 ? (
          <Section title="Structure">
            <p className="text-sm text-fg-secondary print:text-neutral-700">
              {entities.map((e) => e.name).join("  ·  ")}
            </p>
          </Section>
        ) : null}

        {/* Materials index — printable list of attached documents by section */}
        {documents.length > 0 ? (
          <Section title="Materials Index">
            <div className="flex flex-col gap-2">
              {DATA_ROOM_SECTIONS.map((s) => {
                const docs = docsBySection.get(s.key);
                if (!docs?.length) return null;
                return (
                  <div key={s.key}>
                    <p className="font-mono text-[9px] uppercase tracking-wider text-fg-muted print:text-neutral-500">
                      {s.label}
                    </p>
                    <ul className="mt-0.5 flex flex-col gap-0.5">
                      {docs.map((d) => {
                        const href = safeHref(d.storage_key);
                        return (
                          <li key={d.id} className="text-sm text-fg-secondary print:text-neutral-700">
                            {href ? (
                              <a href={href} className="text-fg-primary underline-offset-2 hover:underline print:text-black">
                                {d.name}
                              </a>
                            ) : (
                              <span className="text-fg-primary print:text-black">{d.name}</span>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                );
              })}
            </div>
          </Section>
        ) : null}

        <footer className="mt-6 border-t border-line pt-3 print:border-neutral-300">
          <p className="font-mono text-[9px] uppercase tracking-wider text-fg-muted print:text-neutral-400">
            {org?.legal_name ?? org?.name ?? ""}
            {org?.description ? `  ·  ${org.description}` : ""}
          </p>
        </footer>
      </article>

      {/* Shareable read-only links */}
      <ShareControls
        shares={shares.map((s) => ({
          id: s.id,
          token: s.token,
          label: s.label,
          expires_at: s.expires_at,
          revoked_at: s.revoked_at,
          created_at: s.created_at,
        }))}
      />

      {/* Access log */}
      <div className="mx-auto mt-8 max-w-2xl print:hidden">
        <h3 className="mb-3 font-display text-lg font-semibold tracking-tight text-fg-primary">Access</h3>
        {views.length === 0 ? (
          <p className="rounded-xl border border-dashed border-line bg-surface-1 px-4 py-6 text-center text-sm text-fg-muted">
            No views yet. Shared links record when the room and its documents are opened.
          </p>
        ) : (
          <div className="flex items-center gap-6 rounded-xl border border-line bg-surface-1 px-4 py-3">
            <div>
              <p className="font-display text-xl font-semibold text-fg-primary">{roomOpens}</p>
              <p className="font-mono text-[9px] uppercase tracking-wider text-fg-muted">Room opens</p>
            </div>
            <div>
              <p className="font-display text-xl font-semibold text-fg-primary">{docOpens}</p>
              <p className="font-mono text-[9px] uppercase tracking-wider text-fg-muted">Document opens</p>
            </div>
            <div className="ml-auto text-right">
              <p className="text-sm text-fg-primary">{lastViewed}</p>
              <p className="font-mono text-[9px] uppercase tracking-wider text-fg-muted">Last viewed</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
