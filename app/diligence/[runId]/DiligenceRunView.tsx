'use client';

import { useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { Badge, Card, ProgressBar, SectionTitle } from '@/components/ui';
import { cn } from '@/lib/utils';
import type { DiligenceAnalystFinding, DiligenceRunDetail } from '@/lib/queries/diligence';
import { convictionTone, statusLabel, statusTone } from '../ui';

function scoreColor(score: number): string {
  if (score >= 70) return 'var(--success)';
  if (score >= 45) return 'var(--gold-1)';
  return 'var(--danger)';
}

function AnalystCard({ finding }: { finding: DiligenceAnalystFinding }) {
  const [open, setOpen] = useState(false);
  const hasDetail = Boolean(finding.detail) || finding.citations.length > 0;

  return (
    <Card className="p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[10.5px] font-semibold uppercase tracking-[0.11em] text-fg-4">
            {finding.laneLabel}
          </div>
          <div className="mt-0.5 text-[14px] font-semibold text-fg-1">{finding.personaLabel}</div>
        </div>
        {finding.score != null ? (
          <Badge tone={convictionTone(finding.score)} className="flex-none text-[10px]">
            {finding.score}/100
          </Badge>
        ) : null}
      </div>

      {finding.score != null ? (
        <ProgressBar
          value={finding.score}
          color={scoreColor(finding.score)}
          height={5}
          className="mt-3"
          ariaLabel={`${finding.laneLabel} score`}
        />
      ) : null}

      <p className="mt-3 text-[12.5px] leading-relaxed text-fg-2">{finding.summary}</p>

      {hasDetail ? (
        <>
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            className="mt-3 inline-flex items-center gap-1.5 text-[11.5px] font-medium text-fg-3 transition hover:text-fg-1"
          >
            <ChevronDown
              size={14}
              strokeWidth={1.9}
              className={cn('transition-transform', open && 'rotate-180')}
              aria-hidden
            />
            {open ? 'Hide detail' : 'Show detail'}
          </button>
          {open ? (
            <div className="mt-3 border-t border-hairline pt-3">
              {finding.detail ? (
                <p className="whitespace-pre-wrap text-[12px] leading-relaxed text-fg-2">
                  {finding.detail}
                </p>
              ) : null}
              {finding.citations.length > 0 ? (
                <div className="mt-3">
                  <div className="text-[10.5px] font-semibold uppercase tracking-[0.11em] text-fg-4">
                    Citations
                  </div>
                  <ul className="mt-1.5 flex flex-col gap-1">
                    {finding.citations.map((c, i) => (
                      <li
                        key={i}
                        className="rounded-md border border-hairline bg-surface-1 px-2.5 py-1.5 text-[11.5px] text-fg-3"
                      >
                        {typeof c === 'string' ? c : JSON.stringify(c)}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </div>
          ) : null}
        </>
      ) : null}
    </Card>
  );
}

export function DiligenceRunView({ run }: { run: DiligenceRunDetail }) {
  const { synthesis } = run;

  return (
    <div className="flex flex-col gap-[18px]">
      <SectionTitle
        eyebrow="Diligence Intelligence Layer"
        title={run.summary || 'Diligence review'}
        className="mb-0"
        action={
          <div className="flex items-center gap-2">
            <Badge tone={statusTone(run.status)} className="text-[10px]">
              {statusLabel(run.status)}
            </Badge>
          </div>
        }
      />

      {/* Synthesis — Earn's final verdict, rendered prominently first. */}
      {synthesis ? (
        <Card className="bg-[linear-gradient(100deg,rgba(247,201,72,0.08),transparent_58%)] p-5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="text-[10.5px] font-semibold uppercase tracking-[0.11em] text-fg-4">
                Synthesis · {synthesis.personaLabel}
              </div>
              <div className="mt-1 text-[15px] font-semibold text-fg-1">
                {synthesis.recommendation || 'Recommendation pending'}
              </div>
            </div>
            {synthesis.conviction != null ? (
              <div className="flex-none text-right">
                <div className="text-[28px] font-semibold tabular-nums tracking-[-0.02em] text-fg-1">
                  {synthesis.conviction}
                </div>
                <div className="text-[10px] font-semibold uppercase tracking-[0.11em] text-fg-4">
                  Conviction
                </div>
              </div>
            ) : null}
          </div>

          {synthesis.conviction != null ? (
            <ProgressBar
              value={synthesis.conviction}
              color={scoreColor(synthesis.conviction)}
              height={6}
              className="mt-4"
              ariaLabel="Conviction"
            />
          ) : null}

          {synthesis.memo ? (
            <p className="mt-4 whitespace-pre-wrap text-[12.5px] leading-relaxed text-fg-2">
              {synthesis.memo}
            </p>
          ) : null}

          {synthesis.followUpQuestions.length > 0 ? (
            <div className="mt-4 border-t border-hairline pt-4">
              <div className="text-[10.5px] font-semibold uppercase tracking-[0.11em] text-fg-4">
                Follow-up questions
              </div>
              <ul className="mt-2 flex flex-col gap-1.5">
                {synthesis.followUpQuestions.map((q, i) => (
                  <li key={i} className="flex gap-2 text-[12.5px] text-fg-2">
                    <span className="font-mono text-[11px] tabular-nums text-fg-4">{i + 1}.</span>
                    <span>{q}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </Card>
      ) : run.status === 'error' ? (
        <Card className="p-5">
          <div className="text-[13px] font-semibold text-danger">Diligence run failed</div>
          <p className="mt-1.5 text-[12.5px] text-fg-3">
            {run.summary || 'The run did not complete. Try running diligence again.'}
          </p>
        </Card>
      ) : (
        <Card className="p-5">
          <p className="text-[12.5px] text-fg-3">Synthesis is not available yet for this run.</p>
        </Card>
      )}

      {/* The six analytical findings. */}
      {run.analysts.length > 0 ? (
        <div>
          <SectionTitle eyebrow="Investment committee" title="Analyst findings" />
          <div className="grid gap-3 md:grid-cols-2">
            {run.analysts.map((f) => (
              <AnalystCard key={f.agent} finding={f} />
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
