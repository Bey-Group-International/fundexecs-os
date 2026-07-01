"use client";

import { useState, useTransition } from "react";
import type { MeetingAnalysis } from "@/lib/claude";

interface FormState {
  title: string;
  participants: string;
  transcript: string;
}

const EMPTY: FormState = { title: "", participants: "", transcript: "" };

async function runAnalysis(form: FormState): Promise<MeetingAnalysis> {
  const res = await fetch("/api/meetings/analyze", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      title: form.title || "Untitled meeting",
      participants: form.participants
        .split(/[,\n]/)
        .map((p) => p.trim())
        .filter(Boolean),
      transcript: form.transcript,
    }),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json() as Promise<MeetingAnalysis>;
}

function ProbabilityGauge({ value }: { value: number }) {
  const pct = Math.round(value * 100);
  const color =
    pct >= 70
      ? "var(--status-success)"
      : pct >= 40
        ? "var(--gold-400)"
        : "var(--status-danger)";
  return (
    <div className="flex items-center gap-3">
      <div
        className="h-2 rounded-full flex-1 bg-[var(--surface-2)]"
        role="progressbar"
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <div
          className="h-2 rounded-full transition-all duration-500"
          style={{ width: `${pct}%`, backgroundColor: color }}
        />
      </div>
      <span className="text-sm font-semibold tabular-nums" style={{ color }}>
        {pct}%
      </span>
    </div>
  );
}

function SentimentBadge({ value }: { value: MeetingAnalysis["sentiment"] }) {
  const map = {
    positive: { label: "Positive", cls: "bg-[var(--status-success)]/15 text-[var(--status-success)]" },
    neutral: { label: "Neutral", cls: "bg-[var(--surface-3)] text-[var(--fg-secondary)]" },
    negative: { label: "Negative", cls: "bg-[var(--status-danger)]/15 text-[var(--status-danger)]" },
  };
  const { label, cls } = map[value];
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${cls}`}>
      {label}
    </span>
  );
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={() => {
        void navigator.clipboard.writeText(text).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        });
      }}
      className="text-xs text-[var(--gold-400)] hover:text-[var(--gold-500)] transition-colors"
    >
      {copied ? "Copied!" : "Copy"}
    </button>
  );
}

export function MeetingCopilotConsole() {
  const [form, setForm] = useState<FormState>(EMPTY);
  const [result, setResult] = useState<MeetingAnalysis | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleChange(e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) {
    setForm((f) => ({ ...f, [e.target.name]: e.target.value }));
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.transcript.trim()) return;
    setError(null);
    startTransition(() => {
      runAnalysis(form)
        .then(setResult)
        .catch((err: unknown) => {
          setError(err instanceof Error ? err.message : "Analysis failed.");
        });
    });
  }

  function handleReset() {
    setForm(EMPTY);
    setResult(null);
    setError(null);
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Input form */}
      <form
        onSubmit={handleSubmit}
        className="rounded-xl border border-[var(--line)] bg-[var(--surface-1)] p-5 flex flex-col gap-4"
      >
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="flex flex-col gap-1">
            <label htmlFor="title" className="text-xs font-medium text-[var(--fg-secondary)]">
              Meeting title
            </label>
            <input
              id="title"
              name="title"
              type="text"
              value={form.title}
              onChange={handleChange}
              placeholder="e.g. LP Intro — Blackstone"
              className="rounded-lg border border-[var(--line)] bg-[var(--surface-0)] px-3 py-2 text-sm text-[var(--fg-primary)] placeholder:text-[var(--fg-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--gold-400)]"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor="participants" className="text-xs font-medium text-[var(--fg-secondary)]">
              Participants (comma-separated)
            </label>
            <input
              id="participants"
              name="participants"
              type="text"
              value={form.participants}
              onChange={handleChange}
              placeholder="John Smith, Jane Doe"
              className="rounded-lg border border-[var(--line)] bg-[var(--surface-0)] px-3 py-2 text-sm text-[var(--fg-primary)] placeholder:text-[var(--fg-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--gold-400)]"
            />
          </div>
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor="transcript" className="text-xs font-medium text-[var(--fg-secondary)]">
            Transcript / notes <span className="text-[var(--status-danger)]">*</span>
          </label>
          <textarea
            id="transcript"
            name="transcript"
            value={form.transcript}
            onChange={handleChange}
            required
            rows={10}
            placeholder="Paste the meeting transcript or your notes here…"
            className="rounded-lg border border-[var(--line)] bg-[var(--surface-0)] px-3 py-2 text-sm text-[var(--fg-primary)] placeholder:text-[var(--fg-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--gold-400)] resize-y font-mono leading-relaxed"
          />
        </div>

        <div className="flex items-center gap-3">
          <button
            type="submit"
            disabled={isPending || !form.transcript.trim()}
            className="rounded-lg bg-[var(--gold-400)] hover:bg-[var(--gold-500)] disabled:opacity-40 disabled:cursor-not-allowed text-black text-sm font-semibold px-5 py-2 transition-colors"
          >
            {isPending ? "Analyzing…" : "Analyze meeting"}
          </button>
          {result && (
            <button
              type="button"
              onClick={handleReset}
              className="text-sm text-[var(--fg-muted)] hover:text-[var(--fg-secondary)] transition-colors"
            >
              New meeting
            </button>
          )}
        </div>
      </form>

      {error && (
        <div className="rounded-lg border border-[var(--status-danger)]/30 bg-[var(--status-danger)]/10 px-4 py-3 text-sm text-[var(--status-danger)]">
          {error}
        </div>
      )}

      {/* Analysis results */}
      {result && (
        <div className="flex flex-col gap-4 animate-fade-up">
          {/* Sentiment + commitment */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="rounded-xl border border-[var(--line)] bg-[var(--surface-1)] p-4 flex flex-col gap-2">
              <p className="text-xs font-medium text-[var(--fg-secondary)] uppercase tracking-wide">Sentiment</p>
              <SentimentBadge value={result.sentiment} />
              <p className="text-xs text-[var(--fg-muted)] mt-1">{result.sentiment_rationale}</p>
            </div>
            <div className="rounded-xl border border-[var(--line)] bg-[var(--surface-1)] p-4 flex flex-col gap-2">
              <p className="text-xs font-medium text-[var(--fg-secondary)] uppercase tracking-wide">
                Commitment probability
              </p>
              <ProbabilityGauge value={result.commitment_probability} />
              <p className="text-xs text-[var(--fg-muted)] mt-1">{result.commitment_rationale}</p>
            </div>
          </div>

          {/* Objections */}
          {result.objections.length > 0 && (
            <div className="rounded-xl border border-[var(--line)] bg-[var(--surface-1)] p-4">
              <p className="text-xs font-medium text-[var(--fg-secondary)] uppercase tracking-wide mb-3">
                Objections raised
              </p>
              <ul className="flex flex-col gap-2">
                {result.objections.map((obj, i) => (
                  <li key={i} className="flex items-start gap-2 text-sm text-[var(--fg-primary)]">
                    <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--status-warning)]" />
                    {obj}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Follow-up draft */}
          <div className="rounded-xl border border-[var(--line)] bg-[var(--surface-1)] p-4">
            <div className="flex items-center justify-between mb-3">
              <p className="text-xs font-medium text-[var(--fg-secondary)] uppercase tracking-wide">
                Follow-up draft
              </p>
              <CopyButton text={result.follow_up_draft} />
            </div>
            <pre className="text-sm text-[var(--fg-primary)] whitespace-pre-wrap font-sans leading-relaxed">
              {result.follow_up_draft}
            </pre>
          </div>

          {/* CRM updates */}
          {result.crm_updates.length > 0 && (
            <div className="rounded-xl border border-[var(--line)] bg-[var(--surface-1)] p-4">
              <p className="text-xs font-medium text-[var(--fg-secondary)] uppercase tracking-wide mb-3">
                Suggested CRM updates
              </p>
              <div className="flex flex-col divide-y divide-[var(--line)]">
                {result.crm_updates.map((u, i) => (
                  <div key={i} className="flex items-start justify-between py-2 gap-4">
                    <span className="text-xs font-medium text-[var(--fg-secondary)] min-w-32 shrink-0">
                      {u.field}
                    </span>
                    <span className="text-xs text-[var(--fg-primary)]">{u.suggested_value}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
