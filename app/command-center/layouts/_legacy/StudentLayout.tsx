import { GraduationCap, Sparkles, Users, BookOpen, type LucideIcon } from 'lucide-react';
import { Badge, Card, SectionTitle } from '@/components/ui';
import { KpiTile } from '@/components/dashboard/KpiTile';
import { TeamAvatar, getSpecialists, getCOO } from '@/lib/team';
import type { NextBestAction } from '@/components/dashboard/EarnNextBestActions';
import type { ChainOfTrustStanding } from '@/components/dashboard/ChainOfTrustStrip';
import { MemberDashboardChrome } from './MemberDashboardChrome';
import type { StudentData } from '@/lib/queries/dashboard';

function buildActions(data: StudentData): NextBestAction[] {
  const actions: NextBestAction[] = [];
  const openLearning = data.learningTasks.find((t) => t.status !== 'done');
  if (openLearning) {
    actions.push({
      id: 'continue-learning',
      title: `Continue: ${openLearning.title}`,
      context: 'Pick up where you left off.',
      cta: 'Open Ask Earn',
      href: '/ask-earn',
      icon: BookOpen as LucideIcon,
      tone: 'azure'
    });
  }
  if (data.networkContacts.length < 3) {
    actions.push({
      id: 'grow-network',
      title: 'Add a contact to your network',
      context: 'Even one peer or mentor compounds over time.',
      cta: 'Open Connections',
      href: '/connections',
      icon: Users as LucideIcon,
      tone: 'azure'
    });
  }
  const firstSpecialist = getSpecialists()[0];
  if (firstSpecialist) {
    actions.push({
      id: 'meet-specialist',
      title: `Meet ${firstSpecialist.name}`,
      context: firstSpecialist.oneLiner,
      cta: 'Ask Earn',
      href: '/ask-earn',
      icon: Sparkles as LucideIcon,
      tone: 'gold'
    });
  }
  actions.push({
    id: 'curated-ops',
    title: 'Browse curated opportunities',
    context: 'Synergies tagged for early-career operators.',
    cta: 'Open Connections',
    href: '/connections',
    icon: GraduationCap as LucideIcon,
    tone: 'azure'
  });
  return actions.slice(0, 5);
}

export interface StudentLayoutProps {
  displayName: string;
  position: string;
  trust: ChainOfTrustStanding;
  load: { data: StudentData | null; empty: boolean; error?: string };
}

export function StudentLayout({ displayName, position, trust, load }: StudentLayoutProps) {
  const coo = getCOO();
  const specialists = getSpecialists();

  if (load.error) {
    return (
      <MemberDashboardChrome
        displayName={displayName}
        position={position}
        trust={trust}
        actions={[]}
      >
        <Card className="p-8 text-center">
          <p className="text-[10.5px] font-semibold uppercase tracking-[0.12em] text-warning">
            Dashboard error
          </p>
          <p className="mt-2 text-[13px] text-fg-2">{load.error}</p>
        </Card>
      </MemberDashboardChrome>
    );
  }

  const data = load.data;
  const actions = data ? buildActions(data) : [];
  const learningCount = data?.learningTasks.length ?? 0;
  const learningDone = (data?.learningTasks ?? []).filter((t) => t.status === 'done').length;

  return (
    <MemberDashboardChrome
      displayName={displayName}
      position={position}
      trust={trust}
      actions={actions}
    >
      <div className="flex flex-col gap-[18px]">
        <div className="grid gap-3.5 sm:grid-cols-3">
          <KpiTile
            label="Learning path"
            value={`${learningDone}/${learningCount}`}
            sub="Tasks complete"
            icon={BookOpen}
            tone="azure"
          />
          <KpiTile
            label="AI brains"
            value={String(data?.brainsKnown ?? specialists.length + 1)}
            sub="Specialists on call"
            icon={Sparkles}
            tone="gold"
          />
          <KpiTile
            label="Network"
            value={String(data?.networkContacts.length ?? 0)}
            sub="Connections growing"
            icon={Users}
            tone="azure"
          />
        </div>

        <Card>
          <SectionTitle eyebrow="Your team" title="Meet the fifteen" className="mb-3" />
          <ul className="grid grid-cols-3 gap-2.5 sm:grid-cols-5">
            <li className="flex flex-col items-center gap-1 text-center">
              <TeamAvatar member={coo} size={36} className="flex-none" />
              <span className="truncate text-[10.5px] font-semibold text-fg-1">{coo.name}</span>
              <Badge tone="gold" className="text-[9px]">
                COO
              </Badge>
            </li>
            {specialists.map((m) => (
              <li key={m.slug} className="flex flex-col items-center gap-1 text-center">
                <TeamAvatar member={m} size={36} className="flex-none" />
                <span className="truncate text-[10.5px] font-semibold text-fg-1">{m.name}</span>
                <span className="truncate text-[9px] text-fg-5">{m.position.split(',')[0]}</span>
              </li>
            ))}
          </ul>
        </Card>

        <div className="grid gap-[18px] lg:grid-cols-2">
          <Card>
            <SectionTitle eyebrow="Learning" title="Your path" className="mb-3" />
            {data && data.learningTasks.length > 0 ? (
              <ul className="flex flex-col gap-1">
                {data.learningTasks.map((t) => (
                  <li
                    key={t.id}
                    className="flex items-center justify-between rounded-lg px-1 py-1.5"
                  >
                    <span className="truncate text-[12.5px] text-fg-2">{t.title}</span>
                    <Badge
                      tone={t.status === 'done' ? 'success' : 'azure'}
                      className="text-[10px] uppercase"
                    >
                      {t.status}
                    </Badge>
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyHint
                title="No learning tasks yet"
                body="Complete onboarding to unlock your path."
                href="/onboarding"
                cta="Complete onboarding"
              />
            )}
          </Card>

          <Card>
            <SectionTitle eyebrow="Curated" title="Opportunities" className="mb-3" />
            {data && data.curatedOpportunities.length > 0 ? (
              <ul className="flex flex-col gap-1.5">
                {data.curatedOpportunities.map((o) => (
                  <li
                    key={o.id}
                    className="rounded-lg border border-hairline bg-surface-1 px-2.5 py-2"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-[12px] text-fg-2">{o.rationale}</p>
                      <Badge tone="azure" className="text-[10px] tabular-nums">
                        {Math.round(o.score ?? 0)}
                      </Badge>
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyHint
                title="No curated picks yet"
                body="Earn will surface opportunities as your profile grows."
                href="/ask-earn"
                cta="Ask Earn"
              />
            )}
          </Card>
        </div>
      </div>
    </MemberDashboardChrome>
  );
}

function EmptyHint({
  title,
  body,
  href,
  cta
}: {
  title: string;
  body: string;
  href: string;
  cta: string;
}) {
  return (
    <div className="rounded-xl border border-dashed border-hairline bg-surface-1 p-5 text-center">
      <p className="text-[12.5px] font-medium text-fg-2">{title}</p>
      <p className="mt-1 text-[11.5px] text-fg-4">{body}</p>
      <a
        href={href}
        className="mt-3 inline-flex text-[11.5px] font-semibold text-azure-1 hover:underline"
      >
        {cta} →
      </a>
    </div>
  );
}
