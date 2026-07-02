"use client";

import { useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { CopyButton } from "./CopyButton";

type Meeting = {
  id: string;
  title: string | null;
  created_at: string;
  started_at: string | null;
  ended_at: string | null;
};

type Report = {
  status: string | null;
  summary: string | null;
  key_points: string[] | null;
  action_items: string[] | null;
  analysis: Record<string, unknown> | null;
  full_transcript: string | null;
};

type Data = { meeting: Meeting; report: Report | null } | null;

const POLL_INTERVAL = 5000;

export default function MeetingReportPage() {
  const { roomId } = useParams<{ roomId: string }>();
  const [data, setData] = useState<Data | undefined>(undefined);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  async function fetchReport() {
    const supabase = createClient();

    const { data: meeting } = await supabase
      .from("live_meetings")
      .select("id, title, created_at, started_at, ended_at")
      .eq("room_code", roomId)
      .single();

    if (!meeting) {
      setData(null);
      stopPolling();
      return;
    }

    const { data: report } = await (supabase as any)
      .from("live_meeting_reports")
      .select("status, summary, key_points, action_items, analysis, full_transcript")
      .eq("meeting_id", meeting.id)
      .order("created_at", { ascending: false })
      .limit(1)
      .single() as { data: Report | null };

    setData({ meeting, report: report ?? null });

    // Stop polling once report is ready or failed
    if (report && report.status !== "generating") {
      stopPolling();
    }
  }

  function stopPolling() {
    if (intervalRef.current !== null) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }

  useEffect(() => {
    fetchReport();

    // Start polling; fetchReport will stop it when status is terminal
    intervalRef.current = setInterval(fetchReport, POLL_INTERVAL);

    return () => stopPolling();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomId]);

  // Initial load
  if (data === undefined) {
    return <GeneratingState />;
  }

  // Meeting not found
  if (data === null) {
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

  // Report row doesn't exist yet or still generating
  if (!report || report.status === "generating") {
    return <GeneratingState />;
  }

  const keyPoints = (report.key_points as string[] | null) ?? [];
  const actionItems = (report.action_items as string[] | null) ?? [];
  const analysis = report.analysis as Record<string, unknown> | null;
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
      {report.summary && (
        <Section title="Summary">
          <p className="text-sm text-[var(--fg-primary)] leading-relaxed">{report.summary}</p>
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
      {report.full_transcript && (
        <details className="rounded-xl border border-[var(--line)] bg-[var(--surface-1)]">
          <summary className="px-4 py-3 text-xs font-medium text-[var(--fg-secondary)] uppercase tracking-wide cursor-pointer select-none">
            Full Transcript
          </summary>
          <pre className="px-4 pb-4 text-xs text-[var(--fg-muted)] whitespace-pre-wrap font-mono leading-relaxed">
            {report.full_transcript}
          </pre>
        </details>
      )}

      {/* Failed state */}
      {report.status === "failed" && (
        <div className="rounded-xl border border-[var(--line)] bg-[var(--surface-1)] p-8 text-center">
          <p className="text-sm text-[var(--fg-muted)]">
            Report generation failed. Please try again later.
          </p>
        </div>
      )}
    </div>
  );
}

function GeneratingState() {
  return (
    <div className="flex flex-col items-center justify-center min-h-[50vh] gap-4">
      <svg
        className="animate-spin h-6 w-6 text-[var(--gold-400)]"
        xmlns="http://www.w3.org/2000/svg"
        fill="none"
        viewBox="0 0 24 24"
        aria-hidden="true"
      >
        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
        <path
          className="opacity-75"
          fill="currentColor"
          d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
        />
      </svg>
      <p className="text-sm text-[var(--fg-muted)]">Generating your report…</p>
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
    mixed: "bg-[var(--status-warning)]/15 text-[var(--status-warning)]",
  };
  const knownKey = value?.toLowerCase();
  const className = map[knownKey] ?? "bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400";
  const label = map[knownKey] ? value : `${value} (?)`;
  return (
    <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium capitalize ${className}`}>
      {label}
    </span>
  );
}
