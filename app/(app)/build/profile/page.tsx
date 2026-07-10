import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionContext } from "@/lib/auth";
import { createServerClient } from "@/lib/supabase/server";
import { ProfileForm } from "@/components/build/ProfileForm";
import { ThesisModule } from "@/components/build/ThesisModule";
import { BrandModule } from "@/components/build/BrandModule";
import { EntityModule } from "@/components/build/EntityModule";
import { ThesisLive } from "@/components/intelligence/ThesisLive";
import { FirmIdentityGuide } from "@/components/build/FirmIdentityGuide";
import { saveOrgProfile } from "./actions";
import {
  IDENTITY_SECTIONS,
  computeIdentityProgress,
  toQuestionDTO,
  type IdentityData,
  type IdentitySectionMeta,
} from "@/lib/firm-identity";
import type { InvestmentThesis, Entity } from "@/lib/supabase/database.types";

export const dynamic = "force-dynamic";

// Build › Firm Identity. One unified, interactive surface that consolidates the
// four foundation modules an operator used to visit separately — Profile,
// Thesis, Brand, and Entity — into a single institutional page. A guided
// interview (FirmIdentityGuide) asks the operator the questions that complete
// the firm's identity and routes them to each section; below it, every section
// is fully editable in place. Everything here propagates to counterparty match
// cards, the Capital Map, and every document Earn drafts.
//
// The legacy /build/thesis, /build/brand, and /build/entity routes redirect
// into this page's section anchors (#thesis, #brand, #entity).

function SectionBand({ n, meta }: { n: number; meta: IdentitySectionMeta }) {
  return (
    <div className="mb-5 flex items-center gap-3">
      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-gold-500/40 bg-gold-500/10 font-mono text-xs text-gold-300">
        {String(n).padStart(2, "0")}
      </span>
      <div className="min-w-0">
        <div className="flex flex-wrap items-baseline gap-2">
          <h2 className="font-display text-xl font-semibold tracking-tight text-fg-primary">
            {meta.label}
          </h2>
          <span className="font-mono text-[10px] uppercase tracking-widest text-gold-400/80">
            {meta.eyebrow}
          </span>
        </div>
        <p className="text-sm text-fg-secondary">{meta.blurb}</p>
      </div>
    </div>
  );
}

export default async function FirmIdentityPage() {
  const ctx = await getSessionContext();
  if (!ctx) redirect("/login");
  if (!ctx.orgId) redirect("/onboarding");

  const supabase = await createServerClient();

  // One parallel batch: the org row (identity + brand fields), theses (mandate),
  // and entities (structure). The section modules below re-fetch their own
  // richer data; here we only need enough to score completion for the guide.
  const [orgRes, thesesRes, entitiesRes] = await Promise.all([
    supabase.from("organizations").select("*").eq("id", ctx.orgId).maybeSingle(),
    supabase
      .from("investment_theses")
      .select("*")
      .eq("organization_id", ctx.orgId)
      .order("is_active", { ascending: false })
      .order("created_at", { ascending: false }),
    supabase.from("entities").select("entity_type").eq("organization_id", ctx.orgId),
  ]);

  const org = (orgRes.data ?? {}) as Record<string, unknown>;
  const str = (key: string) => (org[key] as string) ?? "";
  const theses = (thesesRes.data ?? []) as InvestmentThesis[];
  const activeThesis = theses[0] ?? null; // ordered active-first, then newest
  const entities = (entitiesRes.data ?? []) as Pick<Entity, "entity_type">[];

  const identityData: IdentityData = {
    org: {
      legal_name: str("legal_name"),
      entity_type: str("entity_type"),
      jurisdiction: str("jurisdiction"),
      website: str("website"),
      description: str("description"),
      tagline: str("tagline"),
      brand_color: str("brand_color"),
      logo_url: str("logo_url"),
      brand_palette: (org.brand_palette as string[] | null) ?? [],
      brand_voice: str("brand_voice"),
    },
    thesis: activeThesis
      ? {
          summary: activeThesis.summary,
          asset_classes: activeThesis.asset_classes,
          geographies: activeThesis.geographies,
          target_irr: activeThesis.target_irr,
          target_moic: activeThesis.target_moic,
          check_size_min: activeThesis.check_size_min,
          check_size_max: activeThesis.check_size_max,
        }
      : null,
    thesisCount: theses.length,
    entityTypes: entities.map((e) => e.entity_type),
  };

  const progress = computeIdentityProgress(identityData);

  return (
    <div className="fx-ambient mx-auto max-w-3xl">
      <Link
        href="/settings#account"
        className="mb-6 inline-flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-widest text-fg-muted transition hover:text-gold-400"
      >
        ← Settings
      </Link>

      <header className="mb-6">
        <span className="font-mono text-[11px] uppercase tracking-[0.25em] text-gold-400">
          Build Hub
        </span>
        <h1 className="mt-2 font-display text-3xl font-semibold tracking-tight text-fg-primary">
          Firm identity
        </h1>
        <p className="mt-2 max-w-prose text-sm text-fg-secondary">
          Profile, thesis, brand, and legal structure — the single foundation LPs, deal
          counterparties, and service providers see, and the brief Earn reads to draft every memo,
          term sheet, and package. Complete it once here; it compounds across the whole OS.
        </p>
      </header>

      <FirmIdentityGuide
        firmName={str("name")}
        progress={{
          overall: progress.overall,
          status: progress.status,
          sections: progress.sections.map((s) => ({
            key: s.key,
            label: s.label,
            eyebrow: s.eyebrow,
            anchor: s.anchor,
            total: s.total,
            doneCount: s.doneCount,
            score: s.score,
            status: s.status,
          })),
        }}
        questions={progress.pending.map(toQuestionDTO)}
      />

      {/* 01 · Identity ---------------------------------------------------- */}
      <section id="identity" className="scroll-mt-24">
        <SectionBand n={1} meta={IDENTITY_SECTIONS[0]} />
        <ProfileForm
          action={saveOrgProfile}
          values={{
            name: str("name"),
            legal_name: str("legal_name"),
            entity_type: str("entity_type"),
            tagline: str("tagline"),
            logo_url: str("logo_url"),
            jurisdiction: str("jurisdiction"),
            website: str("website"),
            description: str("description"),
            hq_location: str("hq_location"),
            aum_range: str("aum_range"),
            fund_count: org.fund_count != null ? String(org.fund_count) : "",
            primary_strategy: str("primary_strategy"),
            operator_role: str("operator_role"),
            brand_voice: str("brand_voice"),
          }}
        />
      </section>

      {/* 02 · Thesis ------------------------------------------------------ */}
      <section id="thesis" className="mt-14 scroll-mt-24 border-t border-line pt-12">
        <SectionBand n={2} meta={IDENTITY_SECTIONS[1]} />
        <ThesisModule />
        <div className="mt-10">
          <ThesisLive />
        </div>
      </section>

      {/* 03 · Brand ------------------------------------------------------- */}
      <section id="brand" className="mt-14 scroll-mt-24 border-t border-line pt-12">
        <SectionBand n={3} meta={IDENTITY_SECTIONS[2]} />
        <BrandModule />
      </section>

      {/* 04 · Entity ------------------------------------------------------ */}
      <section id="entity" className="mt-14 scroll-mt-24 border-t border-line pt-12">
        <SectionBand n={4} meta={IDENTITY_SECTIONS[3]} />
        <EntityModule />
      </section>
    </div>
  );
}
