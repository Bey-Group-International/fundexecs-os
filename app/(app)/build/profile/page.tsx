import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionContext } from "@/lib/auth";
import { createServerClient } from "@/lib/supabase/server";
import { saveOrgProfile } from "./actions";
import { STRATEGY_LABELS, AUM_LABELS, ROLE_LABELS, displayLabel, titleCase } from "@/lib/labels";
import { ProfileForm } from "@/components/build/ProfileForm";

export const dynamic = "force-dynamic";

// Investor-facing firm profile. Every field here propagates to counterparty
// match cards, the Capital Map, and the Ecosystem Discoverability feed.
// The Earn Copilot reads this profile when drafting LP outreach, term sheets,
// and deal memos — a complete profile meaningfully improves output quality.
// The editor itself is the shared ProfileForm; this page adds the framing and
// the read-only "how counterparties see you" investor card.

export default async function ProfilePage() {
  const ctx = await getSessionContext();
  if (!ctx) redirect("/login");
  if (!ctx.orgId) redirect("/onboarding");

  const supabase = await createServerClient();
  const { data: org } = await supabase
    .from("organizations")
    .select(
      "name, legal_name, entity_type, tagline, logo_url, primary_strategy, operator_role, aum_range, fund_count, hq_location, jurisdiction, website, description, brand_voice, discoverable, slug",
    )
    .eq("id", ctx.orgId)
    .maybeSingle();

  const o = org ?? {};

  return (
    <div className="fx-ambient mx-auto max-w-3xl">
      {/* Back crumb */}
      <Link
        href="/settings#account"
        className="mb-6 inline-flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-widest text-fg-muted transition hover:text-gold-400"
      >
        ← Settings
      </Link>

      <header className="mb-8">
        <span className="font-mono text-[11px] uppercase tracking-[0.25em] text-gold-400">
          Build Hub
        </span>
        <h1 className="mt-2 font-display text-3xl font-semibold tracking-tight text-fg-primary">
          Organization profile
        </h1>
        <p className="mt-2 max-w-prose text-sm text-fg-secondary">
          This is your firm&apos;s public identity across the FundExecs ecosystem — shown to LPs,
          deal counterparties, and service providers when you&apos;re discoverable. Earn also reads
          this profile to draft communications and assess fit.
        </p>
      </header>

      {/* Canonical profile editor — shared with the in-session ModuleView view.
          Its own compact preview is disabled here in favor of the full investor
          card below. */}
      <ProfileForm
        action={saveOrgProfile}
        showPreview={false}
        values={{
          name: (o as Record<string, unknown>).name as string ?? "",
          legal_name: (o as Record<string, unknown>).legal_name as string ?? "",
          entity_type: (o as Record<string, unknown>).entity_type as string ?? "",
          tagline: (o as Record<string, unknown>).tagline as string ?? "",
          logo_url: (o as Record<string, unknown>).logo_url as string ?? "",
          jurisdiction: (o as Record<string, unknown>).jurisdiction as string ?? "",
          website: (o as Record<string, unknown>).website as string ?? "",
          description: (o as Record<string, unknown>).description as string ?? "",
          hq_location: (o as Record<string, unknown>).hq_location as string ?? "",
          aum_range: (o as Record<string, unknown>).aum_range as string ?? "",
          fund_count:
            (o as Record<string, unknown>).fund_count != null
              ? String((o as Record<string, unknown>).fund_count)
              : "",
          primary_strategy: (o as Record<string, unknown>).primary_strategy as string ?? "",
          operator_role: (o as Record<string, unknown>).operator_role as string ?? "",
          brand_voice: (o as Record<string, unknown>).brand_voice as string ?? "",
        }}
      />
      <div className="mt-6">
        <Link
          href="/settings"
          className="text-sm text-fg-muted transition hover:text-fg-secondary"
        >
          ← Back to settings
        </Link>
      </div>

      {/* ── Investor Preview ─────────────────────────────────── */}
      <div className="mt-12 border-t border-line pt-10">
        <span className="font-mono text-[10px] uppercase tracking-widest text-gold-400/80">
          How counterparties see you
        </span>
        <h2 className="mt-1 font-display text-xl font-semibold tracking-tight text-fg-primary">
          Profile card preview
        </h2>
        <p className="mt-1.5 mb-5 text-sm text-fg-secondary">
          This is the card shown in match results, the Capital Map, and ecosystem search.
          Complete your profile above to fill in empty fields.
        </p>

        <div className="fx-glass overflow-hidden rounded-2xl border border-gold-500/20 p-6">
          {/* Header row */}
          <div className="flex items-start gap-4">
            {/* Avatar placeholder */}
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border border-gold-500/30 bg-gold-500/10 font-display text-lg font-bold text-gold-300">
              {((o as Record<string, unknown>).name as string ?? "?")[0]?.toUpperCase() ?? "?"}
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-display text-base font-semibold text-fg-primary">
                  {((o as Record<string, unknown>).name as string) || (
                    <span className="italic text-fg-muted">Display name</span>
                  )}
                </span>
                {!!(o as Record<string, unknown>).discoverable && (
                  <span className="rounded-full border border-green-500/30 bg-green-500/10 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider text-green-400">
                    Discoverable
                  </span>
                )}
              </div>
              <p className="mt-0.5 text-xs text-fg-secondary">
                {[
                  (o as Record<string, unknown>).operator_role
                    ? displayLabel((o as Record<string, unknown>).operator_role as string, ROLE_LABELS)
                    : null,
                  (o as Record<string, unknown>).entity_type
                    ? titleCase((o as Record<string, unknown>).entity_type as string)
                    : null,
                  (o as Record<string, unknown>).hq_location,
                ]
                  .filter(Boolean)
                  .join(" · ") || (
                  <span className="italic text-fg-muted">Role · Entity type · Location</span>
                )}
              </p>
            </div>
          </div>

          {/* Tagline */}
          {(o as Record<string, unknown>).tagline ? (
            <p className="mt-3 text-sm font-medium text-fg-primary">
              {(o as Record<string, unknown>).tagline as string}
            </p>
          ) : (
            <p className="mt-3 text-sm italic text-fg-muted">Your tagline appears here.</p>
          )}

          {/* Description */}
          {(o as Record<string, unknown>).description ? (
            <p className="mt-2 line-clamp-3 text-sm text-fg-secondary">
              {(o as Record<string, unknown>).description as string}
            </p>
          ) : (
            <p className="mt-2 text-sm italic text-fg-muted">
              Add a firm description to help LPs and counterparties understand your mandate.
            </p>
          )}

          {/* Stats row */}
          <div className="mt-4 flex flex-wrap gap-x-5 gap-y-2 border-t border-line pt-4">
            {!!(o as Record<string, unknown>).primary_strategy && (
              <Stat label="Strategy" value={displayLabel((o as Record<string, unknown>).primary_strategy as string, STRATEGY_LABELS)} />
            )}
            {!!(o as Record<string, unknown>).aum_range && (
              <Stat label="AUM" value={displayLabel((o as Record<string, unknown>).aum_range as string, AUM_LABELS)} />
            )}
            {(o as Record<string, unknown>).fund_count != null && (
              <Stat
                label="Funds"
                value={String((o as Record<string, unknown>).fund_count)}
              />
            )}
            {!!(o as Record<string, unknown>).jurisdiction && (
              <Stat label="Jurisdiction" value={(o as Record<string, unknown>).jurisdiction as string} />
            )}
            {!!(o as Record<string, unknown>).website && (
              <a
                href={(o as Record<string, unknown>).website as string}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-gold-400 transition hover:text-gold-300"
              >
                {(o as Record<string, unknown>).website as string} ↗
              </a>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Sub-components ──────────────────────────────────────────────────────────

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="font-mono text-[9px] uppercase tracking-wider text-fg-muted">{label}</span>
      <span className="text-xs font-medium text-fg-primary">{value}</span>
    </div>
  );
}
