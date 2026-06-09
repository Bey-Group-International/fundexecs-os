'use client';

import { useState, type FormEvent } from 'react';
import { ArrowUp, MessageSquare, FileText, ShieldCheck } from 'lucide-react';
import { Badge, Card, SectionTitle, type BadgeTone } from '@/components/ui';
import { EmptyState } from '@/components/shell/EmptyState';
import { cn } from '@/lib/utils';
import type {
  LpQuestion,
  LpQuestionDraft,
  LpQuestionStatus,
  LpQuestionSubmitResult
} from './types';

const STATUS_TONE: Record<LpQuestionStatus, BadgeTone> = {
  open: 'warning',
  answered: 'success',
  archived: 'neutral'
};

const STATUS_LABEL: Record<LpQuestionStatus, string> = {
  open: 'Open',
  answered: 'Answered',
  archived: 'Archived'
};

export interface LpQAChatProps {
  questions: LpQuestion[];
  /** Composer submit handler. The shell only fires this when `body` is non-empty. */
  onSubmit?: (draft: LpQuestionDraft) => Promise<LpQuestionSubmitResult | void>;
  /** Optional explicit composer-disabled state (e.g. for read-only LPs). */
  composerDisabled?: boolean;
  className?: string;
}

/**
 * LpQAChat — threaded, citation-aware Q&A.
 * Submitting calls the provided server action and only shows confirmation
 * after the question persists.
 */
export function LpQAChat({
  questions,
  onSubmit,
  composerDisabled = false,
  className
}: LpQAChatProps) {
  const [draft, setDraft] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const body = draft.trim();
    if (!body) return;
    if (!onSubmit) {
      setError('Question submission is unavailable right now.');
      return;
    }
    setPending(true);
    setError(null);
    setSubmitted(false);
    try {
      const result = await onSubmit({ body });
      if (result && !result.ok) {
        setError(result.error);
        return;
      }
      setDraft('');
      setSubmitted(true);
      setTimeout(() => setSubmitted(false), 2600);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Question could not be recorded.');
    } finally {
      setPending(false);
    }
  }

  return (
    <Card className={cn('p-5', className)} data-testid="lp-qa-chat">
      <div className="mb-3 flex items-center justify-between gap-3">
        <SectionTitle
          eyebrow="Q&A · every question logged, every answer cited"
          title="Ask Eleanor"
        />
        <Badge tone="azure" dot className="text-[10px]">
          {questions.length} threads
        </Badge>
      </div>

      {questions.length === 0 ? (
        <EmptyState
          variant="card"
          title="No questions yet"
          body="Be the first to ask — Eleanor responds within one business day, citations attached."
        />
      ) : (
        <ol className="flex flex-col gap-3">
          {questions.map((q) => (
            <li
              key={q.id}
              data-testid={`lp-question-${q.id}`}
              className="rounded-xl border border-hairline bg-bg-1 px-4 py-3 shadow-[var(--shadow-sm)]"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-[11px] font-semibold text-fg-2">{q.askedBy}</span>
                <div className="flex items-center gap-2 text-[10.5px] tabular-nums text-fg-4">
                  <span>{q.askedAt}</span>
                  <Badge tone={STATUS_TONE[q.status]} className="text-[9.5px] uppercase">
                    {STATUS_LABEL[q.status]}
                  </Badge>
                </div>
              </div>
              <p className="mt-1.5 text-[13px] leading-relaxed text-fg-1">{q.body}</p>

              {q.thread.length > 0 && (
                <ol className="mt-3 flex flex-col gap-2 border-l border-hairline pl-3">
                  {q.thread.map((answer) => (
                    <li
                      key={answer.id}
                      data-testid={`lp-answer-${answer.id}`}
                      className="rounded-lg bg-surface-1 px-3 py-2.5"
                    >
                      <div className="flex items-center gap-2 text-[10.5px] text-fg-4">
                        <span className="inline-flex h-5 w-5 items-center justify-center rounded-full border border-[var(--gold-line)] bg-[var(--gold-soft)] text-[10px] font-semibold text-gold-1">
                          E
                        </span>
                        <span className="font-medium text-fg-2">{answer.author}</span>
                        {answer.authorRole ? (
                          <>
                            <span aria-hidden>·</span>
                            <span>{answer.authorRole}</span>
                          </>
                        ) : null}
                        <span aria-hidden>·</span>
                        <span>{answer.postedAt}</span>
                      </div>
                      <p className="mt-1 text-[12.5px] leading-relaxed text-fg-2">{answer.body}</p>
                      {answer.citations && answer.citations.length > 0 ? (
                        <ul
                          className="mt-2 flex flex-wrap gap-1.5"
                          aria-label="Citations from Earn"
                        >
                          {answer.citations.map((cite) => (
                            <li
                              key={cite.id}
                              data-testid={`lp-answer-citation-${cite.id}`}
                              className="inline-flex items-center gap-1 rounded-full border border-hairline bg-bg-1 px-2 py-0.5 text-[10px] font-medium text-fg-3"
                            >
                              <FileText size={9} strokeWidth={2} aria-hidden />
                              {cite.label}
                            </li>
                          ))}
                        </ul>
                      ) : null}
                    </li>
                  ))}
                </ol>
              )}
            </li>
          ))}
        </ol>
      )}

      {/* Composer */}
      <form
        onSubmit={handleSubmit}
        data-testid="lp-qa-composer"
        className="mt-4 rounded-xl border border-hairline bg-bg-1 px-3 py-2.5 shadow-[var(--shadow-sm)] focus-within:border-[var(--accent-line)]"
      >
        <label htmlFor="lp-qa-composer-textarea" className="sr-only">
          Ask Eleanor a question
        </label>
        <textarea
          id="lp-qa-composer-textarea"
          data-testid="lp-qa-composer-textarea"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Ask Eleanor a question. Every reply is on the record."
          rows={2}
          disabled={composerDisabled || pending}
          className="w-full resize-none border-0 bg-transparent text-[13px] text-fg-1 outline-none placeholder:text-fg-4 disabled:opacity-60"
        />
        <div className="mt-1 flex items-center justify-between gap-2">
          <span className="inline-flex items-center gap-1.5 text-[10.5px] text-fg-4">
            <ShieldCheck size={11} strokeWidth={2} className="text-success" aria-hidden />
            Eleanor reads every message · audit-ready replies
          </span>
          <button
            type="submit"
            disabled={composerDisabled || pending || draft.trim().length === 0}
            data-testid="lp-qa-composer-submit"
            className="inline-flex items-center gap-1.5 rounded-xl border border-transparent bg-[var(--cta-gradient)] px-3 py-1.5 text-[12px] font-semibold text-white shadow-[var(--shadow-cta)] transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          >
            <MessageSquare size={12} strokeWidth={2} aria-hidden />
            {pending ? 'Recording' : 'Send'}
            <ArrowUp size={12} strokeWidth={2} aria-hidden />
          </button>
        </div>
        {error ? (
          <p className="mt-2 text-[10.5px] text-danger" role="alert">
            {error}
          </p>
        ) : null}
        {submitted ? (
          <p className="mt-2 text-[10.5px] text-success" data-testid="lp-qa-composer-confirmation">
            Recorded — Eleanor will reply on the record, typically within one business day.
          </p>
        ) : null}
      </form>
    </Card>
  );
}
