"use client";

// The questions a report could not answer from the transcript, put to the host.
//
// A muffled line or a recording that cut out used to surface as a decision
// reading "None could be confirmed from the available recording due to audio
// quality issues" — a dead end, and one that went into the follow-up email.
// Now the report asks instead. The host, who was in the room, answers here;
// the answers go through the correction path as authoritative and the report
// is regenerated with them. Anyone else sees the questions and who can settle
// them.
import { useState } from "react";
import { useRouter } from "next/navigation";
import { answersAsCorrection } from "@/lib/meetings/report-gaps";
import { MAX_CORRECTION_CHARS } from "@/lib/meetings/report-versions";

export function OpenQuestions({
  meetingId,
  questions,
  isHost,
}: {
  meetingId: string;
  questions: string[];
  isHost: boolean;
}) {
  const router = useRouter();
  const [answers, setAnswers] = useState<string[]>(() => questions.map(() => ""));
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);

  if (questions.length === 0) return null;

  const correction = answersAsCorrection(questions.map((question, i) => ({ question, answer: answers[i] ?? "" })));
  const answered = questions.filter((_, i) => (answers[i] ?? "").trim()).length;
  const tooLong = correction.length > MAX_CORRECTION_CHARS;

  async function submit() {
    if (!correction || tooLong) return;
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch(`/api/meetings/${meetingId}/report/regenerate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ correction }),
      });
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setMessage({ tone: "error", text: json.error ?? "The report could not be updated with your answers." });
        return;
      }
      setMessage({ tone: "ok", text: "Updating the report with your answers. The previous version is kept in the history." });
      router.refresh();
    } catch {
      setMessage({ tone: "error", text: "The report could not be updated with your answers. Check your connection." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section
      aria-labelledby="open-questions-title"
      className="flex flex-col gap-3 rounded-xl border border-[var(--gold-400)]/40 bg-[var(--gold-400)]/5 px-4 py-3"
    >
      <div>
        <p id="open-questions-title" className="text-xs font-semibold uppercase tracking-wide text-[var(--fg-primary)]">
          {questions.length === 1 ? "1 question to complete this report" : `${questions.length} questions to complete this report`}
        </p>
        <p className="mt-0.5 text-xs text-[var(--fg-muted)]">
          {isHost
            ? "The recording did not settle these. Your answers override the transcript, and the report and follow-up are rewritten with them."
            : "The recording did not settle these. The host can answer them to complete the report."}
        </p>
      </div>

      <ol className="flex flex-col gap-3">
        {questions.map((question, i) => (
          <li key={`${i}-${question}`} className="flex flex-col gap-1.5">
            <p className="flex items-start gap-2 text-sm text-[var(--fg-primary)]">
              <span className="mt-0.5 shrink-0 text-[var(--gold-400)]" aria-hidden="true">?</span>
              <span className="min-w-0 flex-1">{question}</span>
            </p>
            {isHost && (
              <textarea
                aria-label={question}
                value={answers[i] ?? ""}
                onChange={(e) => setAnswers((current) => current.map((a, j) => (j === i ? e.target.value : a)))}
                rows={2}
                disabled={busy}
                placeholder="Your answer"
                className="ml-5 w-[calc(100%-1.25rem)] resize-y rounded-lg border border-[var(--line)] bg-[var(--surface-0)] p-2.5 text-sm leading-relaxed text-[var(--fg-primary)] focus:border-[var(--gold-400)] focus:outline-none disabled:opacity-50"
              />
            )}
          </li>
        ))}
      </ol>

      {isHost && (
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => void submit()}
            disabled={busy || !correction || tooLong}
            className="rounded-lg bg-[var(--gold-400)] px-3 py-1.5 text-xs font-semibold text-[#0d0d10] transition-opacity disabled:opacity-50"
          >
            {busy
              ? "Updating report…"
              : answered > 0 && answered < questions.length
                ? `Update report with ${answered} ${answered === 1 ? "answer" : "answers"}`
                : "Update report with answers"}
          </button>
          {tooLong && (
            <p className="text-xs text-[var(--status-danger,#ef4444)]">
              Answers are limited to {MAX_CORRECTION_CHARS.toLocaleString()} characters in total.
            </p>
          )}
        </div>
      )}

      {message && (
        <p
          role={message.tone === "error" ? "alert" : "status"}
          className={`text-xs ${message.tone === "error" ? "text-[var(--status-danger,#ef4444)]" : "text-[var(--fg-muted)]"}`}
        >
          {message.text}
        </p>
      )}
    </section>
  );
}
