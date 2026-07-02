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
} from "@/lib/supabase/database.types";
import { blendTrackRecord } from "@/lib/track-record";
import { computeBuildReadiness } from "@/lib/build-readiness";
import { DATA_ROOM_SECTIONS, summarizeDataRoom } from "@/lib/data-room";
import { SectionHighlighter } from "@/components/build/SectionHighlighter";
import { scoreDocument } from "@/lib/document-quality";
import { PrintButton } from "./PrintButton";
import { ShareControls } from "./ShareControls";
import { CoverageAccordion } from "./CoverageAccordion";
import { ViewerAnalytics } from "./ViewerAnalytics";
import { NdaSignatures } from "./NdaSignatures";

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
    <div className="rounded-xl border border-line bg-surface-0 px-4 py-3 text-center print:border-neutral-300 print:bg-white" style={{ boxShadow: "0 1px 4px rgba(0,0,0,0.12)" }}>
      <p className="font-display text-2xl font-semibold leading-none text-fg-primary print:text-black">
        {value}
      </p>
      <p className="mt-1.5 font-mono text-[9px] uppercase tracking-wider text-fg-muted print:text-neutral-500">
        {label}
      </p>
    </div>
  );
}

function Section({ title, accent, children }: { title: string; accent?: string | null; children: React.ReactNode }) {
  return (
    <section className="mt-6">
      <div className="mb-3 flex items-center gap-2">
        <span
          className="h-4 w-0.5 rounded-full"
          style={{ backgroundColor: accent ?? "#D4AF6A" }}
        />
        <h3 className="font-mono text-[10px] uppercase tracking-[0.2em] text-fg-muted print:text-neutral-500">
          {title}
        </h3>
      </div>
      {children}
    </section>
  );
}

// Coverage arc SVG — shows weighted % as a thin arc on a circle
function CoverageArc({ percent }: { percent: number }) {
  const r = 22;
  const circ = 2 * Math.PI * r;
  const dash = (percent / 100) * circ;
  return (
    <svg width={60} height={60} viewBox="0 0 60 60" className="shrink-0" aria-hidden>
      <circle cx={30} cy={30} r={r} fill="none" stroke="currentColor" strokeWidth={4} className="text-line" />
      <circle
        cx={30} cy={30} r={r}
        fill="none"
        stroke="#D4AF6A"
        strokeWidth={4}
        strokeDasharray={`${dash} ${circ}`}
        strokeLinecap="round"
        transform="rotate(-90 30 30)"
        className="transition-all duration-700"
      />
      <text x={30} y={35} textAnchor="middle" className="fill-fg-primary font-display text-[13px] font-semibold">
        {percent}%
      </text>
    </svg>
  );
}

// Materials & Data Room: the firm's whole Build foundation — identity, thesis,
// pooled track record, structure, team — assembled into a single branded,
// print-ready set of materials LPs can review.
export async function MaterialsModule() {
  const ctx = await getSessionContext();
  if (!ctx?.orgId) redirect("/login");
  const supabase = createServerClient();

  const [orgRes, thesesRes, recordsRes, entitiesRes, membersRes, docsRes, sharesRes] =
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
    ]);

  const org = orgRes.data as Organization | null;
  const theses = (thesesRes.data ?? []) as InvestmentThesis[];
  const thesis = theses.find((t) => t.is_active) ?? theses[0] ?? null;
  const records = (recordsRes.data ?? []) as TrackRecord[];
  const entities = (entitiesRes.data ?? []) as Entity[];
  const members = (membersRes.data ?? []) as OrganizationMember[];
  const documents = (docsRes.data ?? []) as Document[];
  const shares = (sharesRes.data ?? []) as DataRoomShare[];

  let principals: Principal[] = [];
  if (members.length) {
    const { data } = await supabase
      .from("principals")
      .select("*")
      .in("id", members.map((m) => m.principal_id));
    principals = (data ?? []) as Principal[];
  }
  const byId = new Map(principals.map((p) => [p.id, p]));

  const docsBySection = new Map<string, Document[]>();
  for (const d of documents) {
    const k = d.doc_type ?? "other";
    const bucket = docsBySection.get(k);
    if (bucket) bucket.push(d);
    else docsBySection.set(k, [d]);
  }
  const docCounts: Record<string, number> = {};
  for (const [k, v] of docsBySection) docCounts[k] = v.length;
  const readiness = computeBuildReadiness({ org, theses, entities, records, members, principals, docCounts });
  const summary = summarizeDataRoom(readiness.statuses, docCounts);

  const blended = blendTrackRecord(records);
  const accent = org?.brand_color && /^#[0-9a-fA-F]{3,8}$/.test(org.brand_color) ? org.brand_color : null;

  const checkSize = [compactUsd(thesis?.check_size_min ?? null), compactUsd(thesis?.check_size_max ?? null)].filter(Boolean);

  // Build accordion sections with inline doc data
  const accordionSections = summary.items.map((item) => ({
    key: item.key,
    label: item.label,
    ready: item.ready,
    docCount: item.docCount,
    viaBuild: item.viaBuild,
    docs: (docsBySection.get(item.key) ?? []).map((d) => {
      const q = d.content ? scoreDocument(d.name, d.doc_type ?? null, d.content) : null;
      return {
        id: d.id,
        name: d.name,
        storage_key: d.storage_key ?? null,
        status: d.status ?? "ready",
        qualityScore: q?.score ?? null,
        qualityLevel: q?.level ?? null,
        qualityGaps: q?.gaps.length ?? null,
      };
    }),
    suggestion: item.suggestion,
    weight: item.weight,
  }));

  const institutionalCount = accordionSections
    .flatMap((s) => s.docs)
    .filter((d) => d.qualityLevel === "Institutional").length;

  const nextSuggestion = summary.suggestions[0]
    ? { key: summary.suggestions[0].key, label: summary.suggestions[0].label, suggestion: summary.suggestions[0].suggestion }
    : null;

  const activeShareCount = shares.filter((s) => !s.revoked_at).length;

  return (
    <div>
      {/* Toolbar */}
      <div className="mb-6 flex items-start justify-between gap-4 print:hidden">
        <div>
          <h2 className="font-display text-2xl font-semibold tracking-tight text-fg-primary">
            Materials &amp; Data Room
          </h2>
          <p className="mt-1 text-sm text-fg-secondary">
            Your foundation, assembled into investor-ready materials.
          </p>
        </div>
        <PrintButton />
      </div>

      {readiness.nextAction ? (
        <Link
          href={readiness.nextAction.href}
          className="mb-5 flex items-center gap-2 rounded-xl border border-gold-500/30 bg-gold-500/5 px-4 py-2.5 text-xs text-fg-secondary transition hover:bg-gold-500/10 print:hidden"
        >
          <span className="font-mono text-[9px] uppercase tracking-wider text-gold-400">
            Make it stronger
          </span>
          <span className="truncate text-fg-primary">{readiness.nextAction.label}</span>
          <span className="ml-auto text-gold-400">→</span>
        </Link>
      ) : null}

      {/* Coverage panel */}
      <SectionHighlighter />
      <div className="mb-8 overflow-hidden rounded-2xl border border-line bg-surface-1 print:hidden" style={{ boxShadow: "0 2px 12px rgba(0,0,0,0.15)" }}>
        {/* Panel header */}
        <div className="flex items-center gap-4 border-b border-line px-5 py-4">
          <div className="flex-1">
            <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-gold-400">
              Institutional Coverage
            </p>
            <p className="mt-0.5 text-sm text-fg-secondary">
              {summary.readyCount} of {summary.total} sections complete — click any row to expand.
            </p>
          </div>
          <CoverageArc percent={summary.weightedPercent} />
        </div>

        {/* Accordion sections */}
        <div className="flex flex-col gap-2 p-4">
          <CoverageAccordion sections={accordionSections} nextSuggestion={nextSuggestion} institutionalCount={institutionalCount} />
        </div>
      </div>

      {/* The branded sheet */}
      <article
        className="mx-auto max-w-2xl overflow-hidden rounded-2xl border border-line bg-surface-1 print:max-w-none print:rounded-none print:border-0 print:bg-white print:text-black"
        style={{ boxShadow: "0 4px 24px rgba(0,0,0,0.18)" }}
      >
        {/* Accent stripe */}
        <div className="h-1 w-full" style={{ backgroundColor: accent ?? "#D4AF6A" }} />

        <div className="p-8 print:p-0">
          {/* Identity header */}
          <header className="flex items-start gap-5 border-b pb-6" style={{ borderColor: accent ? `${accent}44` : "rgba(255,255,255,0.08)" }}>
            {org?.logo_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={org.logo_url}
                alt=""
                className="h-14 w-14 shrink-0 rounded-xl object-contain"
              />
            ) : (
              <span
                className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl font-display text-2xl font-semibold text-surface-0"
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
                <p className="mt-1 text-sm text-fg-secondary print:text-neutral-700">{org.tagline}</p>
              ) : null}
              <p className="mt-2 font-mono text-[10px] uppercase tracking-wider text-fg-muted print:text-neutral-500">
                {[org?.entity_type, org?.jurisdiction, org?.website].filter(Boolean).join("  ·  ") || "—"}
              </p>
            </div>
          </header>

          {/* Track record */}
          <Section title="Track Record" accent={accent}>
            {blended.dealCount > 0 ? (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
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
              <p className="text-sm text-fg-muted print:text-neutral-500">No track record captured yet.</p>
            )}
            {blended.dealCount > 0 ? (
              <p className="mt-2.5 font-mono text-[10px] uppercase tracking-wider text-fg-muted print:text-neutral-500">
                {blended.dealCount} deals · {blended.realizedCount} realized
                {blended.vintageRange ? ` · vintages ${blended.vintageRange.from}–${blended.vintageRange.to}` : ""}
              </p>
            ) : null}
          </Section>

          {/* Thesis */}
          {thesis ? (
            <Section title="Investment Thesis" accent={accent}>
              <p className="text-sm font-semibold text-fg-primary print:text-black">{thesis.title}</p>
              {thesis.summary ? (
                <p className="mt-1.5 text-sm leading-relaxed text-fg-secondary print:text-neutral-700">
                  {thesis.summary}
                </p>
              ) : null}
              <p className="mt-2.5 font-mono text-[10px] uppercase tracking-wider text-fg-muted print:text-neutral-500">
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
            <Section title="Team" accent={accent}>
              <div className="flex flex-wrap gap-2">
                {members.map((m) => {
                  const p = byId.get(m.principal_id);
                  const name = p?.full_name || p?.email || "Member";
                  return (
                    <span
                      key={m.id}
                      className="rounded-full border border-line bg-surface-0 px-3 py-1.5 text-xs text-fg-secondary print:border-neutral-300 print:bg-white print:text-neutral-700"
                    >
                      <span className="font-medium text-fg-primary print:text-black">{name}</span>
                      {p?.title ? <span className="text-fg-muted print:text-neutral-500"> · {p.title}</span> : null}
                    </span>
                  );
                })}
              </div>
            </Section>
          ) : null}

          {/* Structure */}
          {entities.length > 0 ? (
            <Section title="Structure" accent={accent}>
              <p className="text-sm text-fg-secondary print:text-neutral-700">
                {entities.map((e) => e.name).join("  ·  ")}
              </p>
            </Section>
          ) : null}

          {/* Materials index */}
          {documents.length > 0 ? (
            <Section title="Materials Index" accent={accent}>
              <div className="flex flex-col gap-3">
                {DATA_ROOM_SECTIONS.map((s) => {
                  const docs = docsBySection.get(s.key);
                  if (!docs?.length) return null;
                  return (
                    <div key={s.key}>
                      <p className="mb-1 font-mono text-[9px] uppercase tracking-wider text-fg-muted print:text-neutral-500">
                        {s.label}
                      </p>
                      <ul className="flex flex-col gap-1">
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

          <footer className="mt-8 border-t border-line pt-4 print:border-neutral-300">
            <p className="font-mono text-[9px] uppercase tracking-wider text-fg-muted print:text-neutral-400">
              {org?.legal_name ?? ""}
              {org?.description ? `  ·  ${org.description}` : ""}
            </p>
          </footer>
        </div>
      </article>

      {/* Share + Access */}
      <div className="mx-auto mt-8 max-w-2xl space-y-8 print:hidden">
        {/* Share controls */}
        <ShareControls
          shares={shares.map((s) => ({
            id: s.id,
            token: s.token,
            label: s.label,
            expires_at: s.expires_at,
            revoked_at: s.revoked_at,
            created_at: s.created_at,
            allowed_sections: (s as { allowed_sections?: string[] | null }).allowed_sections ?? null,
          }))}
          activeCount={activeShareCount}
        />

        <ViewerAnalytics />
        <NdaSignatures />
      </div>
    </div>
  );
}
