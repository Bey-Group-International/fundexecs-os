import { redirect } from "next/navigation";
import Link from "next/link";
import { getSessionContext } from "@/lib/auth";
import { createServerClient } from "@/lib/supabase/server";
import { copilotLive } from "@/lib/claude";
import { getActiveIntegrations } from "@/lib/integrations/active";
import { orgConnectedChannels } from "@/lib/integrations/gateway";
import Copilot from "@/components/Copilot";
import { PromptChips } from "@/components/workspace/PromptChips";
import type { Session, SessionGroup } from "@/lib/supabase/database.types";

export const dynamic = "force-dynamic";

const EARN_EXAMPLES = [
  "Source family offices matching our mandate",
  "Draft an LP update memo",
  "Run IC diligence on a target",
  "Build an LBO model",
  "Map the capital network",
];

function relativeTime(iso: string | null): string {
  if (!iso) return "";
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.round(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.round(hrs / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export default async function SessionsPage({
  searchParams,
}: {
  searchParams?: Promise<{ q?: string | string[] }>;
}) {
  const ctx = await getSessionContext();
  if (!ctx) redirect("/login");
  if (!ctx.orgId) redirect("/onboarding");

  const supabase = await createServerClient();

  const [connected, sessionsRes, groupsRes] = await Promise.all([
    orgConnectedChannels(supabase, ctx.orgId),
    supabase
      .from("sessions")
      .select("id, name, color, group_id, pinned_at, created_at, updated_at")
      .eq("organization_id", ctx.orgId)
      .is("archived_at", null)
      .order("updated_at", { ascending: false })
      .limit(50),
    supabase
      .from("session_groups")
      .select("id, name")
      .eq("organization_id", ctx.orgId)
      .order("created_at", { ascending: true }),
  ]);

  const sessions = (sessionsRes.data ?? []) as (Session & { updated_at: string | null })[];
  const groups = (groupsRes.data ?? []) as SessionGroup[];

  const groupById = new Map(groups.map((g) => [g.id, g.name]));
  const pinned = sessions.filter((s) => s.pinned_at);
  const recent = sessions.filter((s) => !s.pinned_at);
  const params = await searchParams;
  const queryPrompt = Array.isArray(params?.q) ? params.q[0] : params?.q;

  return (
    <div className="fx-ambient mx-auto max-w-5xl">
      <header className="mb-8 flex items-start justify-between gap-4">
        <div>
          <span className="font-mono text-[11px] uppercase tracking-[0.25em] text-gold-400">
            FundExecs OS
          </span>
          <h1 className="mt-2 font-display text-3xl font-semibold tracking-tight text-fg-primary">
            Sessions
          </h1>
          <p className="mt-1 text-sm text-fg-secondary">
            Every conversation with Earn — pick up where you left off or start something new.
          </p>
        </div>
      </header>

      {sessions.length === 0 ? (
        <div className="flex flex-col items-center rounded-2xl border border-dashed border-line bg-surface-1 px-8 py-14 text-center">
          <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-gold-400">
            No sessions yet
          </span>
          <p className="mt-2 max-w-sm text-sm text-fg-secondary">
            Ask Earn to source LPs, draft an IC memo, run diligence, or build an LBO model.
            Each conversation becomes a session you can return to.
          </p>
          <PromptChips examples={EARN_EXAMPLES} />
          <p className="mt-3 text-[11px] text-fg-muted">
            Pick one to open Earn with context, or type directly in the composer below ↓
          </p>
        </div>
      ) : (
        <>
          {pinned.length > 0 && (
            <section className="mb-8">
              <h2 className="mb-3 font-mono text-[10px] uppercase tracking-widest text-fg-muted">
                Pinned
              </h2>
              <div className="flex flex-col gap-1.5">
                {pinned.map((s) => (
                  <SessionCard key={s.id} s={s} groupName={s.group_id ? groupById.get(s.group_id) ?? null : null} />
                ))}
              </div>
            </section>
          )}

          <section>
            <h2 className="mb-3 font-mono text-[10px] uppercase tracking-widest text-fg-muted">
              Recent
            </h2>
            <div className="flex flex-col gap-1.5">
              {recent.map((s) => (
                <SessionCard key={s.id} s={s} groupName={s.group_id ? groupById.get(s.group_id) ?? null : null} />
              ))}
            </div>
          </section>
        </>
      )}

      <div className="sticky bottom-0 z-10 mt-6 border-t border-line/60 bg-surface-0/95 pb-2 pt-3 backdrop-blur-xl">
        <p className="mb-2 px-1 font-mono text-[10px] uppercase tracking-wider text-fg-muted">
          Earn can · source LPs · draft memos · run diligence · build models · map capital networks
        </p>
        <Copilot
          orgId={ctx.orgId}
          live={copilotLive()}
          bundles={[]}
          integrations={getActiveIntegrations(connected)}
          initialPrompt={queryPrompt ?? ""}
        />
      </div>
    </div>
  );
}

function SessionCard({
  s,
  groupName,
}: {
  s: Session & { updated_at: string | null };
  groupName: string | null;
}) {
  return (
    <Link
      href={`/session/${s.id}`}
      className="fx-card fx-card-hover group flex items-center gap-3 px-4 py-3"
    >
      <span
        className="h-2.5 w-2.5 shrink-0 rounded-full"
        style={{ backgroundColor: s.color ?? "#a1a1aa" }}
      />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium text-fg-primary">{s.name}</span>
        {groupName && (
          <span className="block truncate text-[11px] text-fg-muted">{groupName}</span>
        )}
      </span>
      <span className="shrink-0 font-mono text-[10px] text-fg-muted">
        {relativeTime(s.updated_at ?? s.created_at ?? null)}
      </span>
      <span className="shrink-0 font-mono text-fg-muted transition group-hover:translate-x-0.5 group-hover:text-gold-400">
        →
      </span>
    </Link>
  );
}
