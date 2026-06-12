'use client';

import { ArrowLeft, FileText, Info, ListChecks, Pencil, ShieldCheck } from 'lucide-react';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import type { FormationDoc } from '@/lib/formation/compose';
import type { FormationItem } from '@/lib/formation/config';
import type { FormationStepMeta } from '@/lib/formation/steps';
import { cn } from '@/lib/utils';

/**
 * The full drafted-document view behind a filed step's "Review" — the
 * substance `composeFormationDoc` renders from the operator's decisions.
 * Clearly badged Illustrative: these are working drafts, not legal
 * instruments. "Reopen & amend" re-runs the wizard; re-approval re-files.
 */
export interface FormationDocViewProps {
  item: FormationItem;
  doc: FormationDoc;
  meta: FormationStepMeta | null;
  onBack: () => void;
  onAmend: () => void;
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric'
  });
}

export function FormationDocView({ item, doc, meta, onBack, onAmend }: FormationDocViewProps) {
  return (
    <div className="mx-auto flex w-full max-w-[720px] flex-col gap-4">
      <div className="flex items-center gap-3">
        <Button variant="outline" size="sm" icon={ArrowLeft} onClick={onBack}>
          Checklist
        </Button>
        <div className="min-w-0 flex-1">
          <h1 className="text-[18px] font-semibold tracking-[-0.015em] text-fg-1">{doc.title}</h1>
          <p className="text-[12px] text-fg-4">{item.who} · drafted by Earn from your decisions</p>
        </div>
        <Badge tone="warning" className="text-[10px]">
          Illustrative
        </Badge>
      </div>

      <Card className="overflow-hidden p-0">
        <div className="flex items-center gap-2.5 border-b border-hairline bg-surface-1 px-[18px] py-3">
          <FileText size={16} className="flex-none text-gold-1" aria-hidden />
          <div className="min-w-0 flex-1">
            <div className="text-[13.5px] font-semibold text-fg-1">{doc.title}</div>
            <div className="truncate text-[11px] text-fg-5">{doc.lede}</div>
          </div>
          {meta && (
            <span className="inline-flex flex-none items-center gap-1.5 text-[10.5px] font-semibold text-success">
              <ShieldCheck size={12} aria-hidden />
              On the record
            </span>
          )}
        </div>

        {meta && (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-[var(--border-faint)] bg-surface-1 px-[18px] py-2 text-[11px] text-fg-4">
            <span>
              Filed <span className="font-medium text-fg-2">{fmtDate(meta.filedAt)}</span>
            </span>
            <span>
              Version <span className="font-mono font-semibold text-fg-2">v{meta.version}</span>
            </span>
            {meta.amendedAt && (
              <span>
                Amended <span className="font-medium text-fg-2">{fmtDate(meta.amendedAt)}</span>
              </span>
            )}
          </div>
        )}

        <div className="flex flex-col gap-5 px-[18px] py-5">
          {doc.sections.map((s) => (
            <section key={s.heading}>
              <h2 className="mb-2 text-[10.5px] font-semibold uppercase tracking-[0.11em] text-fg-4">
                {s.heading}
              </h2>
              {s.rows.length > 0 && (
                <div className="mb-2 overflow-hidden rounded-[12px] border border-hairline">
                  {s.rows.map(([k, v], i) => (
                    <div
                      key={`${k}-${i}`}
                      className={cn(
                        'flex gap-3.5 px-[14px] py-2.5',
                        i % 2 === 0 ? 'bg-surface-1' : 'bg-transparent',
                        i > 0 && 'border-t border-[var(--border-faint)]'
                      )}
                    >
                      <span className="w-[170px] flex-none text-[12px] text-fg-4">{k}</span>
                      <span className="text-[13px] font-medium text-fg-1">{v}</span>
                    </div>
                  ))}
                </div>
              )}
              {s.paras.map((p) => (
                <p key={p.slice(0, 40)} className="mt-1.5 text-[13px] leading-relaxed text-fg-2">
                  {p}
                </p>
              ))}
            </section>
          ))}
        </div>

        <div className="flex items-start gap-2.5 border-t border-hairline bg-surface-1 px-[18px] py-3">
          <Info size={13} className="mt-0.5 flex-none text-gold-1" aria-hidden />
          <p className="text-[11.5px] leading-relaxed text-fg-4">{doc.disclaimer}</p>
        </div>
      </Card>

      <div className="flex flex-wrap items-center justify-between gap-2.5">
        <Button variant="outline" icon={ListChecks} onClick={onBack}>
          Back to checklist
        </Button>
        <Button variant="gold" icon={Pencil} onClick={onAmend}>
          Reopen &amp; amend
        </Button>
      </div>
    </div>
  );
}
