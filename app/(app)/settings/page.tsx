import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionContext } from "@/lib/auth";
import { createServerClient } from "@/lib/supabase/server";
import { signOut } from "@/app/login/actions";
import type { ApiKey, MandateRow } from "@/lib/supabase/database.types";
import { loadOrgConnections } from "@/lib/integrations/gateway";
import { NewMandateForm } from "./NewMandateForm";
import { Connections } from "./Connections";
import { DigestPreferences } from "./DigestPreferences";
import { loadDigestPrefs } from "./digest-actions";
import { ApiKeys, type ApiKeyView } from "./ApiKeys";
import { GuidedTourSetting } from "./GuidedTourSetting";
import { ShortcutsAndCustomization } from "./ShortcutsAndCustomization";
import { DownloadOSCard } from "@/components/DownloadOS";
import { SettingsNav, type SettingsSection } from "./SettingsNav";
import { TIER_2_ACTIONS } from "./tier2-actions";
import { deactivateMandate, setDiscoverable } from "./actions";
import { UserProfileForm } from "./UserProfileForm";

export const dynamic = "force-dynamic";

// The Settings surface is organized into anchored sections with a sticky rail,
// so the account-menu deep links (/settings#integrations, /settings#help, …)
// land exactly where they should. Visual language follows the Command Center:
// fx-card surfaces, a gold ambient glow, hairline borders.

const SECTIONS: SettingsSection[] = [
  { id: "account", label: "Account" },
  { id: "get-the-os", label: "Get the OS" },
  { id: "mandates", label: "AI Permissions" },
  { id: "integrations", label: "Integrations" },
  { id: "digest", label: "Digest" },
  { id: "api", label: "API keys" },
  { id: "shortcuts", label: "Shortcuts" },
  { id: "help", label: "Help" },
  { id: "about", label: "About" },
];

export default async function SettingsPage() {
  const ctx = await getSessionContext();
  if (!ctx) redirect("/login");
  if (!ctx.orgId) redirect("/onboarding");

  const supabase = createServerClient();
  const { data } = await supabase
    .from("mandates")
    .select("*")
    .eq("is_active", true)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const activeMandate = (data as MandateRow | null) ?? null;

  // Issued API keys and stored third-party secrets for this org. We never send
  // the secret hash or ciphertext to the client — only the display fragments.
  const { data: keyRows } = await supabase
    .from("api_keys")
    .select("*")
    .order("created_at", { ascending: false });
  const apiKeys: ApiKeyView[] = ((keyRows as ApiKey[] | null) ?? []).map((k) => ({
    id: k.id,
    name: k.name,
    mode: k.mode,
    publishable_key: k.publishable_key,
    secret_prefix: k.secret_prefix,
    secret_last4: k.secret_last4,
    last_used_at: k.last_used_at,
    revoked_at: k.revoked_at,
    created_at: k.created_at,
  }));

  // Ecosystem discoverability — drives the toggle below. Defaults to on for a
  // freshly onboarded org (the column default), so treat a null as discoverable.
  const { data: orgRow } = await supabase
    .from("organizations")
    .select("discoverable")
    .eq("id", ctx.orgId)
    .maybeSingle();
  const discoverable = (orgRow as { discoverable: boolean | null } | null)?.discoverable !== false;

  const { data: principalRow } = await supabase
    .from("principals")
    .select("full_name, title, phone, avatar_url")
    .eq("id", ctx.userId)
    .maybeSingle();

  // Per-org integration connections brokered by the unified gateway.
  const connections = await loadOrgConnections(supabase, ctx.orgId);

  // Per-org, per-channel delivery prefs for the Act-now Radar digest.
  const { prefs: digestPrefs } = await loadDigestPrefs();

  const labelFor = (kind: string) =>
    TIER_2_ACTIONS.find((a) => a.kind === kind)?.label ?? kind;

  return (
    <div className="fx-ambient mx-auto max-w-5xl">
      <header className="mb-8">
        <span className="font-mono text-[11px] uppercase tracking-[0.25em] text-gold-400">
          Settings
        </span>
        <h1 className="mt-2 font-display text-3xl font-semibold tracking-tight text-fg-primary">
          Workspace & account
        </h1>
        <p className="mt-2 max-w-prose text-sm text-fg-secondary">
          Tune how Earn acts on your behalf, see where it reaches the outside world, and find your
          way around — all in one place.
        </p>
      </header>

      <div className="grid grid-cols-1 gap-8 md:grid-cols-[180px_1fr]">
        {/* Sticky section rail */}
        <div className="hidden md:block">
          <div className="sticky top-2">
            <SettingsNav sections={SECTIONS} />
          </div>
        </div>

        <div className="flex min-w-0 flex-col gap-12">
          {/* Account */}
          <Section id="account" eyebrow="You" title="Account">
            <div className="flex flex-col gap-2">
              <UserProfileForm
                email={ctx.email}
                initialValues={{
                  full_name: (principalRow as any)?.full_name ?? "",
                  title: (principalRow as any)?.title ?? "",
                  phone: (principalRow as any)?.phone ?? "",
                  avatar_url: (principalRow as any)?.avatar_url ?? "",
                }}
              />
              <div className="fx-card p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-fg-primary">Ecosystem discoverability</p>
                    <p className="mt-1 text-xs leading-snug text-fg-secondary">
                      {discoverable
                        ? "On — Earn matches your profile across the ecosystem and alerts matching LPs, capital, partners, providers, and deals."
                        : "Off — your firm is dark. No match alerts go out about you, and you receive none."}
                    </p>
                  </div>
                  <form action={setDiscoverable} className="shrink-0">
                    <input type="hidden" name="discoverable" value={discoverable ? "false" : "true"} />
                    <button
                      className={`rounded-md border px-2.5 py-1 text-xs font-medium transition ${
                        discoverable
                          ? "border-line text-fg-secondary hover:bg-surface-2 hover:text-fg-primary"
                          : "border-gold-500/40 bg-gold-500/10 text-gold-300 hover:bg-gold-500/20"
                      }`}
                    >
                      {discoverable ? "Go dark" : "Make discoverable"}
                    </button>
                  </form>
                </div>
              </div>
              <Link href="/wallet" className="fx-card fx-card-hover group p-4">
                <RowLink label="Wallet & credits" hint="Balance, plan, and billing" />
              </Link>
            </div>
          </Section>

          {/* Get the OS */}
          <Section
            id="get-the-os"
            eyebrow="Native App"
            title="Get the OS"
            description="Download FundExecs OS directly to any device — no app store required. iOS, Android, Mac, Windows, and Linux builds are all self-hosted and always up to date."
          >
            <DownloadOSCard />
          </Section>

          {/* Mandates */}
          <Section
            id="mandates"
            eyebrow="AI Permissions"
            title="What Earn Can Do"
            description="A mandate defines your AI permissions: pre-authorize specific external actions to run without manual approval each time. Capital- and compliance-binding actions always require your explicit approval."
          >
            {activeMandate ? (
              <div className="fx-card mb-4 p-4">
                <div className="flex items-start gap-3">
                  <span
                    className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-status-success"
                    aria-label="active"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-medium text-fg-primary">
                        {activeMandate.name}
                      </span>
                      <span className="rounded-full border border-gold-500/40 bg-gold-500/10 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider text-gold-300">
                        Active
                      </span>
                    </div>
                    {activeMandate.goal ? (
                      <p className="mt-1 text-xs leading-snug text-fg-secondary">
                        {activeMandate.goal}
                      </p>
                    ) : null}
                    {activeMandate.auto_approve.length ? (
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {activeMandate.auto_approve.map((kind) => (
                          <span
                            key={kind}
                            className="rounded-full border border-line bg-surface-0 px-2 py-0.5 text-[10px] text-fg-secondary"
                          >
                            {labelFor(kind)}
                          </span>
                        ))}
                      </div>
                    ) : (
                      <p className="mt-2 font-mono text-[10px] uppercase tracking-wider text-fg-muted">
                        No actions pre-authorized
                      </p>
                    )}
                  </div>

                  <form action={deactivateMandate} className="shrink-0">
                    <input type="hidden" name="id" value={activeMandate.id} />
                    <button className="rounded-md border border-line px-2.5 py-1 text-xs text-fg-secondary transition hover:border-status-danger/40 hover:text-status-danger">
                      Stand down
                    </button>
                  </form>
                </div>
              </div>
            ) : (
              <p className="fx-card mb-4 border-dashed p-6 text-center text-sm text-fg-muted">
                No active mandate. Every external action waits for your approval until you activate
                one.
              </p>
            )}

            <NewMandateForm tier2Actions={TIER_2_ACTIONS} />
          </Section>

          {/* Integrations */}
          <Section
            id="integrations"
            eyebrow="Reach"
            title="Integrations"
            description="Dispatch channels carry approved external actions to the outside world. Today only Gmail actually sends live once connected — every other channel below prepares the action but does not yet deliver it, regardless of connection state (real provider plumbing is on the roadmap)."
          >
            <Connections connections={connections} />
          </Section>

          {/* Digest preferences */}
          <Section
            id="digest"
            eyebrow="Cadence"
            title="Digest preferences"
            description="Decide how the Act-now Radar digest and weekly funnel rollup reach you. Turn each channel on or off, point it at a Slack channel or inbox, pick a daily or weekly cadence, and set the minimum priority bar an item must clear to make the cut."
          >
            <DigestPreferences prefs={digestPrefs} />
          </Section>

          {/* API keys */}
          <Section
            id="api"
            eyebrow="Developers"
            title="API keys"
            description="Issue FundExecs-native credentials to call the FundExecs OS API. Each key is a publishable/secret pair: the publishable key is safe to embed, the secret authenticates server-to-server (send it as an Authorization: Bearer header). The secret is shown once at creation — store it safely, and rotate or revoke any time."
          >
            <ApiKeys keys={apiKeys} />
          </Section>

          {/* Shortcuts & Customization */}
          <Section
            id="shortcuts"
            eyebrow="Preferences"
            title="Shortcuts & customization"
            description="Keyboard shortcuts for navigating FundExecs OS, and appearance settings for this device."
          >
            <ShortcutsAndCustomization />
          </Section>

          {/* Help */}
          <Section
            id="help"
            eyebrow="Support"
            title="Help & guidance"
            description="Get oriented, or reach a human when you need one."
          >
            <div className="flex flex-col gap-2">
              <GuidedTourSetting orgId={ctx.orgId} />
              <a href="mailto:support@fundexecs.com" className="fx-card fx-card-hover group p-4">
                <RowLink label="Contact support" hint="support@fundexecs.com" external />
              </a>
              <Link href="/" className="fx-card fx-card-hover group p-4">
                <RowLink label="Documentation & guides" hint="Learn how each hub works" />
              </Link>
            </div>
          </Section>

          {/* About */}
          <Section id="about" eyebrow="Learn more" title="About FundExecs OS">
            <div className="fx-glass p-5">
              <p className="font-display text-lg font-semibold text-fg-primary">FundExecs OS</p>
              <p className="mt-1 max-w-prose text-sm text-fg-secondary">
                The operating system for fund executives — Earn turns mandates into supervised,
                end-to-end action across diligence, capital, and compliance.
              </p>
              <div className="mt-4 flex flex-wrap gap-x-5 gap-y-2 text-xs">
                <Link href="/marketplace" className="text-gold-300 transition hover:text-gold-200">
                  Marketplace →
                </Link>
                <Link href="/dashboard" className="text-gold-300 transition hover:text-gold-200">
                  Command Center →
                </Link>
                <Link href="/wallet" className="text-gold-300 transition hover:text-gold-200">
                  Plans & credits →
                </Link>
              </div>
              <p className="mt-4 font-mono text-[10px] uppercase tracking-widest text-fg-muted">
                FundExecs OS · {new Date().getFullYear()}
              </p>
            </div>
          </Section>

          <form action={signOut} className="pt-2">
            <button className="rounded-md border border-line px-3 py-1.5 text-sm text-fg-secondary transition hover:border-status-danger/40 hover:text-status-danger">
              Sign out
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}

// A consistent section shell: an anchor target with comfortable scroll offset,
// an eyebrow + title, and an optional lead paragraph.
function Section({
  id,
  eyebrow,
  title,
  description,
  children,
}: {
  id: string;
  eyebrow: string;
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className="scroll-mt-6">
      <header className="mb-4">
        <span className="font-mono text-[10px] uppercase tracking-widest text-gold-400/80">
          {eyebrow}
        </span>
        <h2 className="mt-1 font-display text-xl font-semibold tracking-tight text-fg-primary">
          {title}
        </h2>
        {description ? (
          <p className="mt-2 max-w-prose text-sm leading-relaxed text-fg-secondary">
            {description}
          </p>
        ) : null}
      </header>
      {children}
    </section>
  );
}

// The label + hint + chevron used by the navigational cards.
function RowLink({
  label,
  hint,
  external,
}: {
  label: string;
  hint: string;
  external?: boolean;
}) {
  return (
    <div className="flex items-center gap-3">
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-fg-primary">{label}</p>
        <p className="mt-0.5 text-xs text-fg-muted">{hint}</p>
      </div>
      <span className="font-mono text-fg-muted transition group-hover:text-gold-400">
        {external ? "↗" : "→"}
      </span>
    </div>
  );
}
