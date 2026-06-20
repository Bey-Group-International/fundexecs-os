import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionContext } from "@/lib/auth";
import { createServerClient } from "@/lib/supabase/server";
import { signOut } from "@/app/login/actions";
import type { MandateRow } from "@/lib/supabase/database.types";
import { NewMandateForm } from "./NewMandateForm";
import { Connections } from "./Connections";
import { GuidedTourSetting } from "./GuidedTourSetting";
import { SettingsNav, type SettingsSection } from "./SettingsNav";
import { TIER_2_ACTIONS } from "./tier2-actions";
import { deactivateMandate } from "./actions";

export const dynamic = "force-dynamic";

// The Settings surface is organized into anchored sections with a sticky rail,
// so the account-menu deep links (/settings#integrations, /settings#help, …)
// land exactly where they should. Visual language follows the Command Center:
// fx-card surfaces, a gold ambient glow, hairline borders.

const SECTIONS: SettingsSection[] = [
  { id: "account", label: "Account" },
  { id: "mandates", label: "Mandates" },
  { id: "integrations", label: "Integrations" },
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
              <div className="fx-card p-4">
                <p className="font-mono text-[10px] uppercase tracking-widest text-fg-muted">
                  Signed in as
                </p>
                <p className="mt-1 text-sm text-fg-primary">{ctx.email}</p>
              </div>
              <Link href="/build/profile" className="fx-card fx-card-hover group p-4">
                <RowLink label="Organization profile" hint="Name, focus, and public details" />
              </Link>
              <Link href="/wallet" className="fx-card fx-card-hover group p-4">
                <RowLink label="Wallet & credits" hint="Balance, plan, and billing" />
              </Link>
            </div>
          </Section>

          {/* Mandates */}
          <Section
            id="mandates"
            eyebrow="Autonomy"
            title="Mandates"
            description="A mandate is your standing job-description for Earn: pre-authorize specific external (Tier 2) actions to run unattended. Capital- and compliance-binding work (Tier 3) always stays with you."
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
            description="Dispatch channels carry approved external actions to the outside world. A connected channel sends for real; an unconnected one runs in mock mode — the action is prepared and queued, not sent — so the gate → dispatch loop works end-to-end before any provider is wired up."
          >
            <Connections />
          </Section>

          {/* Help */}
          <Section
            id="help"
            eyebrow="Support"
            title="Help & guidance"
            description="Get oriented, or reach a human when you need one."
          >
            <div className="flex flex-col gap-2">
              <GuidedTourSetting />
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
