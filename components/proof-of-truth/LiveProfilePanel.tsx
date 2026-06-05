'use client';

import { Globe, Link2, ExternalLink } from 'lucide-react';
import { Badge, Card, ProgressBar } from '@/components/ui';
import { EarnCoin } from '@/components/screens/EarnCoin';
import { MEMBER_TYPE_LABELS, type MemberType } from '@/lib/member-types';
import { assembleProfile, completionPct, type Answers } from './profile-mapping';

interface LiveProfilePanelProps {
  memberType: MemberType;
  answers: Answers;
}

function FieldBlock({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="border-b border-hairline py-3 last:border-0">
      <div className="mb-1 text-[10.5px] font-semibold uppercase tracking-[0.11em] text-fg-4">
        {label}
      </div>
      {children}
    </div>
  );
}

function Empty() {
  return <span className="text-[12.5px] italic text-fg-5">Not added yet</span>;
}

function Chips({ items }: { items: string[] }) {
  if (!items.length) return <Empty />;
  return (
    <div className="flex flex-wrap gap-1.5">
      {items.map((t) => (
        <span
          key={t}
          className="rounded-lg border border-hairline bg-surface-2 px-2 py-0.5 text-[12px] font-medium text-fg-2"
        >
          {t}
        </span>
      ))}
    </div>
  );
}

/**
 * LiveProfilePanel — the verified profile assembling in real time as the member
 * answers Earn's questions. Shows a completion bar plus each field as it fills.
 */
export function LiveProfilePanel({ memberType, answers }: LiveProfilePanelProps) {
  const p = assembleProfile(memberType, answers);
  const pct = completionPct(memberType, answers);
  const linkEntries = Object.entries(p.links);

  return (
    <Card className="overflow-hidden p-0">
      <div className="flex items-center gap-3 bg-[linear-gradient(105deg,rgba(247,201,72,0.12),rgba(247,201,72,0.02)_46%,transparent_72%)] px-5 py-4">
        <EarnCoin size={40} glow className="flex-none" />
        <div className="min-w-0 flex-1">
          <div className="text-[10.5px] font-semibold uppercase tracking-[0.11em] text-fg-4">
            Your verified profile
          </div>
          <div className="truncate text-[15px] font-semibold tracking-[-0.015em] text-fg-1">
            {p.displayName || 'Untitled member'}
          </div>
        </div>
        <Badge tone="gold" className="flex-none px-2 py-px text-[10.5px]">
          {MEMBER_TYPE_LABELS[memberType]}
        </Badge>
      </div>

      <div className="px-5 pb-2 pt-4">
        <div className="mb-1.5 flex items-center justify-between text-[11.5px] text-fg-4">
          <span>Profile completion</span>
          <span className="tabular-nums">{pct}%</span>
        </div>
        <ProgressBar value={pct} height={8} gradient="linear-gradient(90deg,#F7C948,#E5A823)" />
      </div>

      <div className="px-5 pb-5">
        <FieldBlock label="Headline">
          {p.headline ? (
            <p className="text-[13px] font-medium text-fg-1">{p.headline}</p>
          ) : (
            <Empty />
          )}
        </FieldBlock>

        <FieldBlock label="Overview">
          {p.bio ? (
            <p className="whitespace-pre-line text-[12.5px] leading-relaxed text-fg-2">{p.bio}</p>
          ) : (
            <Empty />
          )}
        </FieldBlock>

        <FieldBlock label="Focus areas">
          <Chips items={p.focusAreas} />
        </FieldBlock>

        {p.details.map(({ question, value, tags }) => (
          <FieldBlock key={question.id} label={question.label}>
            {question.kind === 'tags' ? (
              <Chips items={tags} />
            ) : (
              <p className="whitespace-pre-line text-[12.5px] leading-relaxed text-fg-2">{value}</p>
            )}
          </FieldBlock>
        ))}

        <FieldBlock label="Links">
          {linkEntries.length ? (
            <ul className="flex flex-col gap-1.5">
              {linkEntries.map(([key, url]) => (
                <li key={key} className="flex items-center gap-2 text-[12.5px] text-fg-2">
                  {key === 'linkedin' ? (
                    <Link2
                      size={14}
                      strokeWidth={1.9}
                      className="flex-none text-fg-4"
                      aria-hidden
                    />
                  ) : (
                    <Globe
                      size={14}
                      strokeWidth={1.9}
                      className="flex-none text-fg-4"
                      aria-hidden
                    />
                  )}
                  <span className="truncate">{url}</span>
                  <ExternalLink size={12} className="flex-none text-fg-5" aria-hidden />
                </li>
              ))}
            </ul>
          ) : (
            <Empty />
          )}
        </FieldBlock>
      </div>
    </Card>
  );
}
