import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionContext } from "@/lib/auth";
import { createServerClient } from "@/lib/supabase/server";
import { saveOrgProfile } from "./actions";
import { STRATEGY_LABELS, AUM_LABELS, ROLE_LABELS, displayLabel, titleCase } from "@/lib/labels";

export const dynamic = "force-dynamic";

// Investor-facing firm profile. Every field here propagates to counterparty
// match cards, the Capital Map, and the Ecosystem Discoverability feed.
// The Earn Copilot reads this profile when drafting LP outreach, term sheets,
// and deal memos — a complete profile meaningfully improves output quality.

const ENTITY_TYPES: { value: string; label: string }[] = [
  { value: "LLC", label: "LLC" },
  { value: "LP", label: "LP" },
  { value: "Corporation", label: "Corporation" },
  { value: "Trust", label: "Trust" },
  { value: "Ltd", label: "Ltd" },
  { value: "GP", label: "GP" },
  { value: "Other", label: "Other" },
];

// Options use DB enum keys as values so defaultValue matches what's stored.
// Labels come from the shared label maps in lib/labels.ts.
const STRATEGIES: { value: string; label: string }[] = [
  { value: "private_equity", label: "Private Equity" },
  { value: "venture_capital", label: "Venture Capital" },
  { value: "real_estate", label: "Real Estate" },
  { value: "credit_debt", label: "Credit / Debt" },
  { value: "infrastructure", label: "Infrastructure" },
  { value: "multi_strategy", label: "Multi-Strategy" },
  { value: "fund_of_funds", label: "Fund of Funds" },
  { value: "hedge_fund", label: "Hedge Fund" },
];

const OPERATOR_ROLES: { value: string; label: string }[] = [
  { value: "gp", label: "GP" },
  { value: "family_office", label: "Family Office" },
  { value: "advisory", label: "Advisory" },
  { value: "operator", label: "Operator" },
];

const AUM_RANGES: { value: string; label: string }[] = [
  { value: "sub_25m", label: "Under $25M" },
  { value: "25m_100m", label: "$25M – $100M" },
  { value: "100m_500m", label: "$100M – $500M" },
  { value: "500m_1b", label: "$500M – $1B" },
  { value: "over_1b", label: "Over $1B" },
];

export default async function ProfilePage() {
  const ctx = await getSessionContext();
  if (!ctx) redirect("/login");
  if (!ctx.orgId) redirect("/onboarding");

  const supabase = createServerClient();
  const { data: org } = await supabase
    .from("organizations")
    .select(
      "name, legal_name, entity_type, tagline, primary_strategy, operator_role, aum_range, fund_count, hq_location, jurisdiction, website, description, brand_voice, discoverable, slug",
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

      {/* The server action returns { error?, ok? } but React form action expects
          (fd: FormData) => void | Promise<void>. The double-cast satisfies
          strict TypeScript without changing runtime behaviour. */}
      <form
        action={saveOrgProfile as unknown as (fd: FormData) => Promise<void>}
        className="flex flex-col gap-10"
      >
        {/* ── Identity ─────────────────────────────────────────── */}
        <Section
          eyebrow="Who you are"
          title="Identity"
          description="The display name and legal entity that appear on match cards and outreach."
        >
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field
              label="Display name"
              name="name"
              defaultValue={(o as Record<string, unknown>).name as string ?? ""}
              placeholder="Bey Group International"
              required
            />
            <Field
              label="Legal entity name"
              name="legal_name"
              defaultValue={(o as Record<string, unknown>).legal_name as string ?? ""}
              placeholder="e.g., Acme Capital Partners, LLC"
            />
            <SelectField
              label="Entity type"
              name="entity_type"
              defaultValue={(o as Record<string, unknown>).entity_type as string ?? ""}
              options={ENTITY_TYPES}
            />
            <Field
              label="Tagline"
              name="tagline"
              defaultValue={(o as Record<string, unknown>).tagline as string ?? ""}
              placeholder="e.g., Growth equity for the next generation of founders"
            />
          </div>
        </Section>

        {/* ── Strategy ─────────────────────────────────────────── */}
        <Section
          eyebrow="What you do"
          title="Strategy & focus"
          description="Earn uses these signals to qualify counterparties and auto-score deal thesis fit."
        >
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <SelectField
              label="Primary strategy"
              name="primary_strategy"
              defaultValue={(o as Record<string, unknown>).primary_strategy as string ?? ""}
              options={STRATEGIES}
            />
            <SelectField
              label="Your role"
              name="operator_role"
              defaultValue={(o as Record<string, unknown>).operator_role as string ?? ""}
              options={OPERATOR_ROLES}
            />
            <SelectField
              label="AUM range"
              name="aum_range"
              defaultValue={(o as Record<string, unknown>).aum_range as string ?? ""}
              options={AUM_RANGES}
            />
            <Field
              label="Active fund count"
              name="fund_count"
              type="number"
              defaultValue={String((o as Record<string, unknown>).fund_count ?? "")}
              placeholder="2"
            />
          </div>
        </Section>

        {/* ── Location & Reach ─────────────────────────────────── */}
        <Section
          eyebrow="Where you operate"
          title="Location & reach"
          description="Geographic signals refine match radius and regulatory fit checks."
        >
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field
              label="HQ location"
              name="hq_location"
              defaultValue={(o as Record<string, unknown>).hq_location as string ?? ""}
              placeholder="New York, NY"
            />
            <Field
              label="Jurisdiction"
              name="jurisdiction"
              defaultValue={(o as Record<string, unknown>).jurisdiction as string ?? ""}
              placeholder="Delaware, USA"
            />
            <Field
              label="Website"
              name="website"
              type="url"
              defaultValue={(o as Record<string, unknown>).website as string ?? ""}
              placeholder="https://beygroupintl.com"
              className="sm:col-span-2"
            />
          </div>
        </Section>

        {/* ── Your Story ───────────────────────────────────────── */}
        <Section
          eyebrow="How you show up"
          title="Positioning"
          description="Earn uses your description and voice to calibrate tone in every LP memo, outreach email, and deal summary it drafts."
        >
          <div className="flex flex-col gap-3">
            <TextareaField
              label="Firm description"
              name="description"
              defaultValue={(o as Record<string, unknown>).description as string ?? ""}
              placeholder="Bey Group International is a multi-strategy alternative investment platform focused on institutional-grade real assets and credit opportunities across North America and Europe..."
              rows={4}
            />
            <TextareaField
              label="Brand voice"
              name="brand_voice"
              defaultValue={(o as Record<string, unknown>).brand_voice as string ?? ""}
              placeholder="Authoritative, direct, and precise. We speak to institutions — no jargon, no hype, just clear conviction backed by data."
              rows={3}
            />
          </div>
        </Section>

        {/* ── Save ─────────────────────────────────────────────── */}
        <div className="flex items-center gap-4 border-t border-line pt-6">
          <button
            type="submit"
            className="rounded-lg border border-gold-500/50 bg-gold-500/10 px-5 py-2 text-sm font-medium text-gold-300 transition hover:bg-gold-500/20 hover:border-gold-400/70 active:scale-[0.98]"
          >
            Save profile
          </button>
          <Link
            href="/settings"
            className="text-sm text-fg-muted transition hover:text-fg-secondary"
          >
            Cancel
          </Link>
        </div>
      </form>

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

function Section({
  eyebrow,
  title,
  description,
  children,
}: {
  eyebrow: string;
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      <header className="mb-4">
        <span className="font-mono text-[10px] uppercase tracking-widest text-gold-400/80">
          {eyebrow}
        </span>
        <h2 className="mt-1 font-display text-xl font-semibold tracking-tight text-fg-primary">
          {title}
        </h2>
        {description && (
          <p className="mt-1.5 max-w-prose text-sm leading-relaxed text-fg-secondary">
            {description}
          </p>
        )}
      </header>
      <div className="fx-card p-4">{children}</div>
    </section>
  );
}

function Field({
  label,
  name,
  defaultValue,
  placeholder,
  type = "text",
  required,
  className,
}: {
  label: string;
  name: string;
  defaultValue?: string;
  placeholder?: string;
  type?: string;
  required?: boolean;
  className?: string;
}) {
  return (
    <div className={`flex flex-col gap-1 ${className ?? ""}`}>
      <label className="font-mono text-[10px] uppercase tracking-wider text-fg-muted">
        {label}
        {required && <span className="ml-0.5 text-gold-400">*</span>}
      </label>
      <input
        type={type}
        name={name}
        defaultValue={defaultValue}
        placeholder={placeholder}
        required={required}
        className="rounded-lg border border-line bg-surface-0 px-3 py-2 text-sm text-fg-primary placeholder:text-fg-muted focus:border-gold-500/60 focus:outline-none focus:ring-1 focus:ring-gold-500/40 transition"
      />
    </div>
  );
}

function SelectField({
  label,
  name,
  defaultValue,
  options,
}: {
  label: string;
  name: string;
  defaultValue?: string;
  options: { value: string; label: string }[];
}) {
  return (
    <div className="flex flex-col gap-1">
      <label className="font-mono text-[10px] uppercase tracking-wider text-fg-muted">
        {label}
      </label>
      <select
        name={name}
        defaultValue={defaultValue ?? ""}
        className="rounded-lg border border-line bg-surface-0 px-3 py-2 text-sm text-fg-primary focus:border-gold-500/60 focus:outline-none focus:ring-1 focus:ring-gold-500/40 transition appearance-none"
      >
        <option value="">Select…</option>
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
    </div>
  );
}

function TextareaField({
  label,
  name,
  defaultValue,
  placeholder,
  rows = 3,
}: {
  label: string;
  name: string;
  defaultValue?: string;
  placeholder?: string;
  rows?: number;
}) {
  return (
    <div className="flex flex-col gap-1">
      <label className="font-mono text-[10px] uppercase tracking-wider text-fg-muted">
        {label}
      </label>
      <textarea
        name={name}
        defaultValue={defaultValue}
        placeholder={placeholder}
        rows={rows}
        className="rounded-lg border border-line bg-surface-0 px-3 py-2 text-sm text-fg-primary placeholder:text-fg-muted focus:border-gold-500/60 focus:outline-none focus:ring-1 focus:ring-gold-500/40 transition resize-y"
      />
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="font-mono text-[9px] uppercase tracking-wider text-fg-muted">{label}</span>
      <span className="text-xs font-medium text-fg-primary">{value}</span>
    </div>
  );
}
