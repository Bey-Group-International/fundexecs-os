import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionContext } from "@/lib/auth";
import { createServerClient } from "@/lib/supabase/server";
import { followUpQueue, type QueueMeeting, type QueueTask } from "@/lib/meetings/follow-up-loop";

export const dynamic = "force-dynamic";

/** How far back the dashboard looks: older follow-ups are history, not a to-do. */
const WINDOW_DAYS = 60;

type Db = { from: (table: string) => any };

/**
 * Everything the host's meetings are still waiting on, in one place:
 * follow-ups not sent, people who haven't replied, follow-ups scheduled to
 * go, and action items past their due date. Each line goes to its report.
 */
export default async function FollowUpsPage() {
  const ctx = await getSessionContext();
  if (!ctx) redirect("/login");
  if (!ctx.orgId) redirect("/onboarding");

  const supabase = (await createServerClient()) as unknown as Db;
  const since = new Date(Date.now() - WINDOW_DAYS * 86_400_000).toISOString();
  const { data: meetingRows } = await supabase
    .from("live_meetings")
    .select("id, title, room_code, ended_at, followup_status")
    .eq("host_id", ctx.userId)
    .eq("organization_id", ctx.orgId)
    .is("deleted_at", null)
    .gte("ended_at", since)
    .order("ended_at", { ascending: false })
    .limit(200);
  const meetings = (meetingRows ?? []) as QueueMeeting[];
  const ids = meetings.map((m) => m.id);

  const [sendsRes, tasksRes] = ids.length
    ? await Promise.all([
        supabase
          .from("live_meeting_followup_sends")
          .select("meeting_id, email, name, status, sent_at, scheduled_for, replied_at, created_at")
          .in("meeting_id", ids)
          .limit(2000),
        supabase
          .from("team_tasks")
          .select("id, title, due_at, status, meeting_id, assigned_to")
          .in("meeting_id", ids)
          .in("status", ["pending", "in_progress", "blocked"])
          .not("due_at", "is", null)
          .limit(500),
      ])
    : [{ data: [] }, { data: [] }];

  const taskRows = ((tasksRes as { data: unknown[] | null }).data ?? []) as Array<Omit<QueueTask, "assignee"> & { assigned_to: string }>;
  const people = new Map<string, string>();
  const assignees = [...new Set(taskRows.map((t) => t.assigned_to))];
  if (assignees.length) {
    const { data } = await supabase.from("principals").select("id, full_name").in("id", assignees);
    for (const p of (data ?? []) as Array<{ id: string; full_name: string | null }>) if (p.full_name) people.set(p.id, p.full_name);
  }

  const queue = followUpQueue(
    meetings,
    ((sendsRes as { data: unknown[] | null }).data ?? []) as Parameters<typeof followUpQueue>[1],
    taskRows.map((t) => ({ ...t, assignee: people.get(t.assigned_to) ?? null })),
    Date.now(),
  );
  const nothing = !queue.notSent.length && !queue.awaiting.length && !queue.scheduled.length && !queue.overdue.length;
  const report = (m: QueueMeeting | null) => (m?.room_code ? `/meetings/${m.room_code}/report#follow-up` : "/meetings");
  const when = (iso: string) => new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "UTC" }) + " UTC";

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-6">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h1 className="text-lg font-semibold text-fg-primary">Follow-ups</h1>
          <p className="text-sm text-fg-muted">What your meetings from the last {WINDOW_DAYS} days are still waiting on.</p>
        </div>
        <Link href="/meetings" className="text-sm text-[var(--gold-400)] hover:underline">
          Back to meetings
        </Link>
      </div>

      {nothing && (
        <p className="rounded-xl border border-line bg-surface-1 p-6 text-center text-sm text-fg-muted">
          You&apos;re all caught up — every follow-up has gone out and nothing is overdue.
        </p>
      )}

      {queue.notSent.length > 0 && (
        <Section title="Follow-up not sent" count={queue.notSent.length}>
          {queue.notSent.map((m) => (
            <Row key={m.id} href={report(m)} title={m.title || "Untitled meeting"} meta={m.ended_at ? `Ended ${when(m.ended_at)}` : null} action="Send" />
          ))}
        </Section>
      )}

      {queue.awaiting.length > 0 && (
        <Section title="Waiting on a reply" count={queue.awaiting.length}>
          {queue.awaiting.map((a) => (
            <Row key={`${a.meeting.id}:${a.email}`} href={report(a.meeting)} title={a.name} meta={`${a.meeting.title || "Untitled meeting"} · sent ${a.days} days ago`} action="Open" />
          ))}
        </Section>
      )}

      {queue.scheduled.length > 0 && (
        <Section title="Scheduled" count={queue.scheduled.length}>
          {queue.scheduled.map((s) => (
            <Row
              key={s.meeting.id}
              href={report(s.meeting)}
              title={s.meeting.title || "Untitled meeting"}
              meta={`${s.count} ${s.count === 1 ? "person" : "people"} · ${when(s.at)}`}
              action="Review"
            />
          ))}
        </Section>
      )}

      {queue.overdue.length > 0 && (
        <Section title="Overdue action items" count={queue.overdue.length}>
          {queue.overdue.map((t) => (
            <Row
              key={t.id}
              href={t.meeting?.room_code ? `/meetings/${t.meeting.room_code}/report#action-items` : "/meetings"}
              title={t.title}
              meta={`${t.assignee ?? "Unassigned"} · ${t.daysLate === 0 ? "due today" : `${t.daysLate} ${t.daysLate === 1 ? "day" : "days"} late`}${t.meeting?.title ? ` · ${t.meeting.title}` : ""}`}
              action="Open"
            />
          ))}
        </Section>
      )}
    </div>
  );
}

function Section({ title, count, children }: { title: string; count: number; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-2" aria-label={title}>
      <h2 className="text-xs font-semibold uppercase tracking-wide text-fg-muted">
        {title} <span className="text-fg-secondary">{count}</span>
      </h2>
      <ul className="flex flex-col gap-1.5">{children}</ul>
    </section>
  );
}

function Row({ href, title, meta, action }: { href: string; title: string; meta: string | null; action: string }) {
  return (
    <li>
      <Link href={href} className="flex min-h-12 items-center gap-3 rounded-xl border border-line bg-surface-1 px-3 py-2 hover:border-gold-400/40 hover:bg-surface-2">
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-sm font-medium text-fg-primary">{title}</span>
          {meta && <span className="truncate text-xs text-fg-muted">{meta}</span>}
        </span>
        <span className="shrink-0 text-xs font-semibold text-[var(--gold-400)]">{action} →</span>
      </Link>
    </li>
  );
}
