import { redirect } from "next/navigation";
import { getSessionContext } from "@/lib/auth";
import { signOut } from "@/app/login/actions";
import { HUB_BY_KEY } from "@/lib/hubs";
import { PLAN_BY_KEY, type PlanKey } from "@/lib/billing";
import type { Hub } from "@/lib/supabase/database.types";
import { GuidedTour } from "@/components/GuidedTour";
import { getWalletBalance } from "@/lib/wallet";
import { createServerClient } from "@/lib/supabase/server";
import { ActiveSessionProvider } from "@/components/session/active-session";
import { GlobalTopBar } from "@/components/GlobalTopBar";
import { AppSidebar } from "@/components/AppSidebar";

// The four hubs, in operating order, as shown in the side rail.
const HUB_ORDER: Hub[] = ["build", "run", "source", "execute"];

// Authed shell. Side rail: Earn (the copilot) + Workflows + Command Center, then
// the four operational hubs (Build / Run / Source / Execute) whose modules
// reveal on hover. Each hub has its own page with a top module switcher.
export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const ctx = await getSessionContext();
  if (!ctx) redirect("/login");
  if (!ctx.orgId) redirect("/onboarding");

  const balance = await getWalletBalance(ctx.orgId);

  // Account display: principal's name + current plan for the side-rail footer.
  // The recent sessions feed the sidebar's conversation list (Claude Code style).
  const supabase = createServerClient();
  const [{ data: principal }, { data: wallet }, { data: recentSessions }] = await Promise.all([
    supabase.from("principals").select("full_name").eq("id", ctx.userId).maybeSingle(),
    supabase.from("wallets").select("plan").eq("organization_id", ctx.orgId).maybeSingle(),
    supabase
      .from("sessions")
      .select("id, name, color")
      .is("archived_at", null)
      .order("created_at", { ascending: false })
      .limit(20),
  ]);

  // Only surface sessions that actually hold work. A session is created lazily
  // on the first prompt (which also creates its workflow), so empty rows never
  // appear in the conversation list.
  const candidates = (recentSessions ?? []) as { id: string; name: string; color: string | null }[];
  const candidateIds = candidates.map((s) => s.id);
  const { data: workflowRows } = candidateIds.length
    ? await supabase.from("tasks").select("session_id").is("parent_task_id", null).in("session_id", candidateIds)
    : { data: [] as { session_id: string | null }[] };
  const sessionsWithWork = new Set((workflowRows ?? []).map((w) => w.session_id));
  const sessions = candidates.filter((s) => sessionsWithWork.has(s.id)).slice(0, 8);
  const name = principal?.full_name?.trim() || ctx.email.split("@")[0] || "Account";
  const planKey = wallet?.plan as PlanKey | null;
  const planName = planKey ? PLAN_BY_KEY[planKey]?.name ?? "Free" : "Free";

  const hubs = HUB_ORDER.map((key) => {
    const hub = HUB_BY_KEY[key];
    return {
      key: hub.key,
      label: hub.label,
      modules: hub.modules.map((mod) => ({
        href: `/${hub.key}/${mod.key}`,
        label: mod.label,
      })),
    };
  });

  return (
    <div className="flex h-screen overflow-hidden bg-surface-0 text-fg-primary">
      <AppSidebar
        name={name}
        planName={planName}
        hubs={hubs}
        sessions={sessions}
        signOutAction={signOut}
      />

      <ActiveSessionProvider>
        <div className="flex flex-1 flex-col overflow-hidden">
          <GlobalTopBar balance={balance} />
          <main className="flex-1 overflow-y-auto px-8 py-8">{children}</main>
        </div>
      </ActiveSessionProvider>

      <GuidedTour />
    </div>
  );
}
