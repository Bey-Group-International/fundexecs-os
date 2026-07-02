// components/CommandCenter.tsx
// The Command Center — the operator's mission control.
import { Suspense } from "react";
import Link from "next/link";
import { buildRelationshipScores, extractDecayAlerts } from "@/lib/relationship-score";
import { buildNBAList } from "@/lib/next-best-action";
import { buildInsights, IntelligenceStrip } from "@/components/IntelligenceStrip";
import { NextBestAction } from "@/components/NextBestAction";
import { createServerClient } from "@/lib/supabase/server";
import { getSessionContext } from "@/lib/auth";
import { CommandCenterSkeleton } from "@/components/CommandCenterSkeleton";
import { CommandCenterError } from "@/components/CommandCenterError";

function formatMeetingDate(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterdayStart = new Date(todayStart.getTime() - 86400000);
  const meetingStart = new Date(date.getFullYear(), date.getMonth(), date.getDate());

  if (meetingStart.getTime() === todayStart.getTime()) return "Today";
  if (meetingStart.getTime() === yesterdayStart.getTime()) return "Yesterday";
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

async function RecentMeetingsCard() {
  const supabase = createServerClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return null;

  const { data: meetings } = await supabase
    .from("live_meetings")
    .select("id, room_code, title, created_at")
    .eq("host_id", user.id)
    .eq("status", "ended")
    .order("created_at", { ascending: false })
    .limit(3);

  const meetingsWithReports = await Promise.all(
    (meetings ?? []).map(async (meeting) => {
      const { data: report } = await supabase
        .from("live_meeting_reports")
        .select("summary, key_points, action_items")
        .eq("meeting_id", meeting.id)
        .maybeSingle();
      return { ...meeting, report };
    })
  );

  return (
    <div className="rounded-xl border border-[var(--line)] bg-[var(--surface-1)] p-4">
      <h2 className="text-sm font-semibold text-[var(--fg-1)] mb-3">Recent Meetings</h2>
      {meetingsWithReports.length === 0 ? (
        <p className="text-xs text-[var(--fg-muted)] py-4 text-center">No meetings yet</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {meetingsWithReports.map((meeting) => {
            const keyPoints: string[] = Array.isArray(meeting.report?.key_points)
              ? (meeting.report.key_points as string[])
              : [];
            const actionItems: unknown[] = Array.isArray(meeting.report?.action_items)
              ? meeting.report.action_items
              : [];
            const actionCount = actionItems.length;

            return (
              <li key={meeting.id}>
                <Link
                  href={`/meetings/${meeting.room_code}/report`}
                  className="flex flex-col gap-1 rounded-lg p-2 -mx-2 hover:bg-[var(--surface-2)] transition-colors"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-medium text-[var(--fg-1)] truncate">
                      {meeting.title ?? "Untitled Meeting"}
                    </span>
                    <span className="text-xs text-[var(--fg-muted)] shrink-0">
                      {formatMeetingDate(meeting.created_at)}
                    </span>
                  </div>
                  {keyPoints.length > 0 && (
                    <ul className="flex flex-col gap-0.5 mt-0.5">
                      {keyPoints.slice(0, 2).map((point, i) => (
                        <li
                          key={i}
                          className="text-xs text-[var(--fg-muted)] flex gap-1.5 items-start"
                        >
                          <span className="mt-1.5 w-1 h-1 rounded-full bg-[var(--fg-muted)] shrink-0" />
                          <span className="line-clamp-1">{String(point)}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                  {actionCount > 0 && (
                    <div className="mt-1">
                      <span className="inline-flex items-center rounded-full bg-[var(--surface-2)] border border-[var(--line)] px-2 py-0.5 text-xs text-[var(--fg-muted)]">
                        {actionCount} {actionCount === 1 ? "action" : "actions"}
                      </span>
                    </div>
                  )}
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

async function CommandCenterContent() {
  const supabase = createServerClient();
  const ctx = await getSessionContext();
  const organizationId = ctx?.orgId;

  if (!organizationId) {
    return null;
  }

  let scores: Awaited<ReturnType<typeof buildRelationshipScores>> = [];
  let nbaItems: ReturnType<typeof buildNBAList> = [];

  try {
    scores = await buildRelationshipScores(supabase, organizationId);
  } catch (err) {
    console.error("[CommandCenter] buildRelationshipScores failed:", err);
  }

  try {
    const decayAlerts = extractDecayAlerts(scores);
    nbaItems = buildNBAList(decayAlerts, scores, { maxItems: 5 });

    const committedCount = scores.filter((s) => s.temperature === "committed").length;
    const warmCount = scores.filter((s) => s.temperature === "warm").length;

    const insights = buildInsights({
      decayAlerts,
      totalInvestors: scores.length,
      committedCount,
      warmCount,
    });

    if (insights.length === 0 && nbaItems.length === 0) {
      return (
        <div className="text-fg-muted text-sm text-center py-8">
          No insights or actions at this time. Check back after syncing your relationships.
        </div>
      );
    }

    return (
      <div className="flex flex-col gap-6">
        {insights.length > 0 && <IntelligenceStrip insights={insights} />}
        <Suspense
          fallback={
            <div className="h-32 rounded-xl bg-[var(--surface-1)] animate-pulse" />
          }
        >
          <RecentMeetingsCard />
        </Suspense>
        <section>
          <NextBestAction items={nbaItems} />
        </section>
      </div>
    );
  } catch (err) {
    console.error("[CommandCenter] failed to build insights/NBA:", err);
    return (
      <div className="text-fg-muted text-sm text-center py-8">
        No insights or actions at this time. Check back after syncing your relationships.
      </div>
    );
  }
}

export function CommandCenter() {
  return (
    <CommandCenterError>
      <Suspense fallback={<CommandCenterSkeleton />}>
        <CommandCenterContent />
      </Suspense>
    </CommandCenterError>
  );
}
