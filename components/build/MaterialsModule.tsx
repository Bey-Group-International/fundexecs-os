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
} from "@/lib/supabase/database.types";
import { blendTrackRecord } from "@/lib/track-record";
import { getBuildReadiness } from "@/lib/build-readiness";
import { PrintButton } from "./PrintButton";

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

  const [orgRes, thesisRes, recordsRes, entitiesRes, membersRes, readiness] = await Promise.all([
    supabase.from("organizations").select("*").eq("id", ctx.orgId).maybeSingle(),
    supabase
      .from("investment_theses")
      .select("*")
      .eq("organization_id", ctx.orgId)
      .order("is_active", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from("track_records")
      .select("*")
      .eq("organization_id", ctx.orgId)
      .order("vintage_year", { ascending: false }),
    supabase.from("entities").select("*").eq("organization_id", ctx.orgId),
    supabase.from("organization_members").select("*").eq("organization_id", ctx.orgId),
    getBuildReadiness(ctx.orgId),
  ]);

  const org = orgRes.data as Organization | null;
  const thesis = thesisRes.data as InvestmentThesis | null;
  const records = (recordsRes.data ?? []) as TrackRecord[];
  const entities = (entitiesRes.data ?? []) as Entity[];
  const members = (membersRes.data ?? []) as OrganizationMember[];

  let principals: Principal[] = [];
  if (members.length) {
    const { data } = await supabase
      .from("principals")
      .select("*")
      .in("id", members.map((m) => m.principal_id));
    principals = (data ?? []) as Principal[];
  }
  const byId = new Map(principals.map((p) => [p.id, p]));

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

        <footer className="mt-6 border-t border-line pt-3 print:border-neutral-300">
          <p className="font-mono text-[9px] uppercase tracking-wider text-fg-muted print:text-neutral-400">
            {org?.legal_name ?? org?.name ?? ""}
            {org?.description ? `  ·  ${org.description}` : ""}
          </p>
        </footer>
      </article>
    </div>
  );
}
