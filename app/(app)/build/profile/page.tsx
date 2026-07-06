import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionContext } from "@/lib/auth";
import { createServerClient } from "@/lib/supabase/server";
import { ProfilePageEditor } from "@/components/build/ProfilePageEditor";

export const dynamic = "force-dynamic";

// Investor-facing firm profile. Every field here propagates to counterparty
// match cards, the Capital Map, and the Ecosystem Discoverability feed.
// The Earn Copilot reads this profile when drafting LP outreach, term sheets,
// and deal memos — a complete profile meaningfully improves output quality.
// The editor + live "how counterparties see you" card are the shared client
// ProfilePageEditor; this page just fetches the org row and frames it.

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

  const o = (org ?? {}) as Record<string, unknown>;
  const str = (key: string) => (o[key] as string) ?? "";

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

      <ProfilePageEditor
        discoverable={!!o.discoverable}
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
          fund_count: o.fund_count != null ? String(o.fund_count) : "",
          primary_strategy: str("primary_strategy"),
          operator_role: str("operator_role"),
          brand_voice: str("brand_voice"),
        }}
      />
    </div>
  );
}
