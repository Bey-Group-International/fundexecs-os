import { Metadata } from "next";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import Link from "next/link";
import { CopyButton } from "./CopyButton";

interface Props {
  params: Promise<{ roomId: string }>;
}

export const metadata: Metadata = {
  title: "Meeting Report — FundExecs OS",
};

async function getReport(roomCode: string) {
  const cookieStore = await cookies();
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { getAll: () => cookieStore.getAll(), setAll: () => {} } },
  );

  const { data: meeting } = await supabase
    .from("live_meetings")
    .select("id, title, created_at, started_at, ended_at")
    .eq("room_code", roomCode)
    .single();

  if (!meeting) return null;

  const { data: report } = await supabase
    .from("live_meeting_reports")
    .select("*")
    .eq("meeting_id", meeting.id)
    .order("created_at", { ascending: false })
    .limit(1)
    .single();

  return { meeting, report };
}

export default async function MeetingReportPage({ params }: Props) {
  const { roomId } = await params;
  const data = await getReport(roomId);

  if (!data) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[50vh] gap-4">
        <p className="text-[var(--fg-muted)]">Meeting not found.</p>
        <Link href="/meetings" className="text-sm text-[var(--gold-400)] hover:underline">
          Back to meetings
        </Link>
      </div>
    );
  }

  const { meeting, report } = data;
  const keyPoints = (report?.key_points as string[] | null) ?? [];
  const actionItems = (report?.action_items as string[] | null) ?? [];
  const analysis = report?.analysis as Record<string, unknown> | null;
  const decisions = (analysis?.decisions as string[] | null) ?? [];
  const followUp = analysis?.follow_up_draft as string | null;
  const sentiment = analysis?.sentiment as string | null;

  const duration = meeting.started_at && meeting.ended_at
    ? Math.round((new Date(meeting.ended_at).getTime() - new Date(meeting.started_at).getTime()) / 60000)
    : null;

  return (
    <div className="max-w-3xl mx-auto px-4 py-8 flex flex-col gap-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <Link href="/meetings" className="text-xs text-[var(--fg-muted)] hover:text-[var(--fg-secondary)]">
              ← Meetings
            </Link>
          </div>
          <h1 className="text-xl font-semibold text-[var(--fg-primary)]">
            {meeting.title ?? "Meeting"}
          </h1>
          <p className="text-sm text-[var(--fg-muted)] mt-0.5">
            {new Date(meeting.created_at as string).toLocaleDateString("en-US", {
              weekday: "long", year: "numeric", month: "long", day: "numeric",
            })}
            {duration ? ` · ${duration} min` : ""}
          </p>
        </div>
        {sentiment && (
          <SentimentBadge value={sentiment} />
        )}
      </div>

      {/* Summary */}
      {report?.summary && (
        <Section title="Summary">
          <p className="text-sm text-[var(--fg-primary)] leading-relaxed">{report.summary as string}</p>
        </Section>
      )}

      {/* Key points + decisions */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {keyPoints.length > 0 && (
          <Section title="Key Points">
            <ul className="flex flex-col gap-2">
              {keyPoints.map((pt, i) => (
                <li key={i} className="flex items-start gap-2 text-sm text-[var(--fg-primary)]">
                  <span className="mt-1.5 w-1.5 h-1.5 rounded-full bg-[var(--gold-400)] shrink-0" />
                  {pt}
                </li>
              ))}
            </ul>
          </Section>
        )}
        {decisions.length > 0 && (
          <Section title="Decisions Made">
            <ul className="flex flex-col gap-2">
              {decisions.map((d, i) => (
                <li key={i} className="flex items-start gap-2 text-sm text-[var(--fg-primary)]">
                  <span className="mt-0.5 text-[var(--status-success)] text-base">✓</span>
                  {d}
                </li>
              ))}
            </ul>
          </Section>
        )}
      </div>

      {/* Action items */}
      {actionItems.length > 0 && (
        <Section title="Action Items">
          <div className="flex flex-col gap-2">
            {actionItems.map((item, i) => (
              <div key={i} className="flex items-start gap-3 rounded-lg border border-[var(--line)] bg-[var(--surface-0)] p-3">
                <span className="text-[var(--fg-muted)] mt-0.5">☐</span>
                <span className="text-sm text-[var(--fg-primary)]">{item}</span>
              </div>
            ))}
          </div>
        </Section>
      )}

      {/* Follow-up draft */}
      {followUp && (
        <Section title="Follow-up Draft" action={<CopyButton text={followUp} />}>
          <pre className="text-sm text-[var(--fg-primary)] whitespace-pre-wrap font-sans leading-relaxed">
            {followUp}
          </pre>
        </Section>
      )}

      {/* Full transcript */}
      {report?.full_transcript && (
        <details className="rounded-xl border border-[var(--line)] bg-[var(--surface-1)]">
          <summary className="px-4 py-3 text-xs font-medium text-[var(--fg-secondary)] uppercase tracking-wide cursor-pointer select-none">
            Full Transcript
          </summary>
          <pre className="px-4 pb-4 text-xs text-[var(--fg-muted)] whitespace-pre-wrap font-mono leading-relaxed">
            {report.full_transcript as string}
          </pre>
        </details>
      )}

      {/* No report yet */}
      {!report && (
        <div className="rounded-xl border border-[var(--line)] bg-[var(--surface-1)] p-8 text-center">
          <p className="text-sm text-[var(--fg-muted)]">
            The meeting report is being generated…
          </p>
        </div>
      )}
    </div>
  );
}

function Section({
  title,
  children,
  action,
}: {
  title: string;
  children: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-[var(--line)] bg-[var(--surface-1)] p-4 flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium text-[var(--fg-secondary)] uppercase tracking-wide">{title}</p>
        {action}
      </div>
      {children}
    </div>
  );
}

function SentimentBadge({ value }: { value: string }) {
  const map: Record<string, string> = {
    positive: "bg-[var(--status-success)]/15 text-[var(--status-success)]",
    neutral: "bg-[var(--surface-3)] text-[var(--fg-secondary)]",
    negative: "bg-[var(--status-danger)]/15 text-[var(--status-danger)]",
  };
  return (
    <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium capitalize ${map[value] ?? map.neutral}`}>
      {value}
    </span>
  );
}

