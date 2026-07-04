import { redirect } from "next/navigation";
import { getSessionContext } from "@/lib/auth";
import { signOut } from "@/app/login/actions";
import { HUB_BY_KEY } from "@/lib/hubs";
import { PLAN_BY_KEY, type PlanKey } from "@/lib/billing";
import type { Hub } from "@/lib/supabase/database.types";
import { GuidedTour } from "@/components/GuidedTour";
import { CoachingToastProvider } from "@/components/shared/CoachingToast";
import {
  createSessionGroup,
  moveSessionToGroup,
  deleteSession,
  renameSession,
  createSessionShare,
  setSessionArchived,
  setSessionPinned,
  setSessionUnread,
} from "@/app/(app)/sessions/actions";
import { getWalletBalance } from "@/lib/wallet";
import { getBuildReadiness, type ModuleStatus } from "@/lib/build-readiness";
import { createServerClient } from "@/lib/supabase/server";
import { ActiveSessionProvider } from "@/components/session/active-session";
import { MobileNavProvider } from "@/components/nav/mobile-nav";
import { GlobalTopBar } from "@/components/GlobalTopBar";
import { MatchToast } from "@/components/inbox/MatchToast";
import { DownloadBanner } from "@/components/DownloadBanner";
import { AppSidebar } from "@/components/AppSidebar";
import { EarnCopilotDock } from "@/components/copilot/EarnCopilotDock";
import { GlobalCommandPalette } from "@/components/GlobalCommandPalette";

const HUB_ORDER: Hub[] = ["build", "source", "run", "execute"];

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const ctx = await getSessionContext();
  if (!ctx) redirect("/login");
  if (!ctx.orgId) redirect("/onboarding");

  const balance = await getWalletBalance(ctx.orgId);

  const supabase = await createServerClient();
  const [
    { data: principal },
    { data: wallet },
    { data: recentSessions },
    { data: groupRows },
    { count: messagesUnread },
    { count: dealsUnread },
    { data: matchAlertRow },
    buildStatuses,
    { count: approvalsCount },
    { data: orgRow },
  ] = await Promise.all([
      supabase.from("principals").select("full_name").eq("id", ctx.userId).maybeSingle(),
      supabase.from("wallets").select("plan").eq("organization_id", ctx.orgId).maybeSingle(),
      supabase
        .from("sessions")
        .select("id, name, color, group_id, pinned_at, unread")
        .eq("organization_id", ctx.orgId)
        .is("archived_at", null)
        .order("pinned_at", { ascending: false, nullsFirst: false })
        .order("created_at", { ascending: false })
        .limit(25),
      supabase
        .from("session_groups")
        .select("id, name")
        .eq("organization_id", ctx.orgId)
        .order("created_at", { ascending: true }),
      supabase
        .from("inbox_threads")
        .select("id", { count: "exact", head: true })
        .eq("organization_id", ctx.orgId)
        .eq("unread", true)
        .eq("status", "open")
        .neq("channel", "deal_share"),
      supabase
        .from("inbox_threads")
        .select("id", { count: "exact", head: true })
        .eq("organization_id", ctx.orgId)
        .eq("unread", true)
        .eq("status", "open")
        .eq("channel", "deal_share"),
      supabase
        .from("inbox_threads")
        .select("id, channel, subject, preview, ai_summary")
        .eq("organization_id", ctx.orgId)
        .in("channel", ["ecosystem", "deal_share"])
        .eq("unread", true)
        .eq("status", "open")
        .order("last_message_at", { ascending: false, nullsFirst: false })
        .limit(1)
        .maybeSingle(),
      getBuildReadiness(ctx.orgId)
        .then((r) => r.statuses)
        .catch(() => null as Record<string, ModuleStatus> | null),
      supabase
        .from("tasks")
        .select("id", { count: "exact", head: true })
        .eq("organization_id", ctx.orgId)
        .is("parent_task_id", null)
        .eq("status", "awaiting_approval"),
      supabase
        .from("organizations")
        .select("setup_hidden")
        .eq("id", ctx.orgId)
        .maybeSingle(),
    ]);

  const matchRow = matchAlertRow as
    | { id: string; channel: string; subject: string; preview: string | null; ai_summary: string | null }
    | null;
  const matchAlert = matchRow
    ? {
        id: matchRow.id,
        title: matchRow.subject,
        body: matchRow.ai_summary ?? matchRow.preview ?? "",
        href: matchRow.channel === "deal_share" ? "/deals/feed" : "/inbox",
      }
    : null;
  const name = principal?.full_name?.trim() || ctx.email.split("@")[0] || "Account";
  const planKey = wallet?.plan as PlanKey | null;
  const planName = planKey ? PLAN_BY_KEY[planKey]?.name ?? "Free" : "Free";

  const candidates = (recentSessions ?? []) as {
    id: string;
    name: string;
    color: string | null;
    group_id: string | null;
    pinned_at: string | null;
    unread: boolean;
  }[];
  const candidateIds = candidates.map((s) => s.id);
  const { data: workflowRows } = candidateIds.length
    ? await supabase
        .from("tasks")
        .select("session_id")
        .is("parent_task_id", null)
        .in("session_id", candidateIds)
    : { data: [] as { session_id: string | null }[] };
  const sessionsWithWork = new Set((workflowRows ?? []).map((w) => w.session_id));
  const sessions = candidates
    .filter((s) => sessionsWithWork.has(s.id))
    .slice(0, 12)
    .map((s) => ({
      id: s.id,
      name: s.name,
      color: s.color,
      groupId: s.group_id,
      pinned: s.pinned_at != null,
      unread: s.unread,
    }));
  const groups = (groupRows ?? []).map((g) => ({ id: g.id, name: g.name }));

  const hubs = HUB_ORDER.map((key) => {
    const hub = HUB_BY_KEY[key];
    return {
      key: hub.key,
      label: hub.label,
      approvalGated: hub.approvalGated ?? false,
      modules: hub.modules.map((mod) => ({
        href: `/${hub.key}/${mod.key}`,
        label: mod.label,
        status: hub.key === "build" ? buildStatuses?.[mod.key] : undefined,
      })),
    };
  });

  return (
    <div className="flex h-dvh overflow-hidden bg-surface-0 text-fg-primary print:block print:h-auto print:overflow-visible">
      <MobileNavProvider>
      <div className="contents print:hidden">
      <AppSidebar
        name={name}
        planName={planName}
        hubs={hubs}
        sessions={sessions}
        groups={groups}
        inboxUnread={(messagesUnread ?? 0) + (approvalsCount ?? 0)}
        signOutAction={signOut}
        createGroupAction={createSessionGroup}
        moveSessionAction={moveSessionToGroup}
        deleteSessionAction={deleteSession}
        renameSessionAction={renameSession}
        shareSessionAction={createSessionShare}
        archiveSessionAction={setSessionArchived}
        pinSessionAction={setSessionPinned}
        unreadSessionAction={setSessionUnread}
      />
      </div>

      <CoachingToastProvider>
      <ActiveSessionProvider>
        <div className="flex flex-1 flex-col overflow-hidden print:overflow-visible">
          <div className="print:hidden">
            <GlobalTopBar
              balance={balance}
              messagesUnread={messagesUnread ?? 0}
              dealsUnread={dealsUnread ?? 0}
            />
            <MatchToast alert={matchAlert} />
            <DownloadBanner />
          </div>
          <main className="flex-1 overflow-y-auto px-4 py-5 sm:px-6 sm:py-6 lg:px-8 lg:py-8 print:overflow-visible print:p-0">
            {children}
          </main>
        </div>
      </ActiveSessionProvider>
      </CoachingToastProvider>

      <div className="print:hidden">
        <GuidedTour orgId={ctx.orgId} initialHidden={orgRow?.setup_hidden ?? false} />
        <EarnCopilotDock name={name} />
        {/* THE app-wide ⌘K palette — one instance, one catalog, every route. */}
        <GlobalCommandPalette />
      </div>
      </MobileNavProvider>
    </div>
  );
}
