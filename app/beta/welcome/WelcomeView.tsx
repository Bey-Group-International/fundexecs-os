'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowRight, Compass, Users, ShieldCheck } from 'lucide-react';
import { track } from '@vercel/analytics';
import { EarnCoin } from '@/components/screens/EarnCoin';
import { Badge } from '@/components/ui';
import { usePrefersReducedMotion, EarnSays, Chip, PRIMARY_BTN } from '@/components/beta/earn-chat';
import { TEAM_ROSTER, TeamAvatar } from '@/lib/team';

type Topic = 'intro' | 'team' | 'value';

/** Best-effort analytics — never let a tracking failure break the flow. */
function ev(name: string, props?: Record<string, string>): void {
  try {
    track(name, props);
  } catch {
    // ignore
  }
}

const BREAKDOWN: Record<Topic, string> = {
  intro:
    'FundExecs OS is one command center where your sourcing, diligence, capital, and relationships run as a single intelligence layer — not fifteen disconnected tools.',
  team: 'Fifteen specialists, each a brain trained for one job — sourcing, diligence, capital, legal, IR. You bring the work; I route it to the right one.',
  value:
    'In the beta you get early access, a direct line to the team, and a real say in what we build. Command Center, Pipeline, and a Chain of Trust on every decision.'
};

/**
 * The post-auth welcome an email-invited member sees before onboarding. They're
 * already signed in (the magic link did that), so this is purely a warm,
 * personalized intro — greet, optional tour, then into building their profile.
 */
export function WelcomeView({
  name,
  inviterName
}: {
  name: string | null;
  inviterName: string | null;
}) {
  const router = useRouter();
  const reducedMotion = usePrefersReducedMotion();
  const [showTour, setShowTour] = useState(false);
  const [topic, setTopic] = useState<Topic>('intro');
  const [entering, setEntering] = useState(false);

  useEffect(() => {
    ev('beta_invite_welcome_view');
  }, []);

  const firstName = name?.trim().split(/\s+/)[0] || '';
  const greeting = `Welcome${firstName ? `, ${firstName}` : ''}. ${
    inviterName ? `${inviterName} invited you` : "You've been invited"
  } into the FundExecs OS private beta. I'm Earn — Earnest Fundmaker, your private-market assistant.`;

  function enter() {
    if (entering) return;
    setEntering(true);
    ev('beta_invite_welcome_enter');
    router.push('/onboarding');
  }

  return (
    <main
      className="relative flex min-h-screen flex-col items-center bg-bg-0 px-6 py-10 text-fg-1"
      style={{
        background:
          'radial-gradient(60% 50% at 80% 8%, rgba(247,201,72,0.12), transparent 70%), radial-gradient(55% 55% at 0% 95%, rgba(37,99,235,0.12), transparent 70%), linear-gradient(180deg, var(--bg-0), var(--bg-1))'
      }}
    >
      <div className="mb-8 flex w-full max-w-xl items-center gap-2.5">
        <EarnCoin size={26} />
        <span className="text-[14px] font-semibold tracking-[-0.02em]">
          FundExecs <span className="font-medium text-fg-4">OS</span>
        </span>
      </div>

      <div className="fx-rise w-full max-w-xl">
        <div className="flex flex-col gap-7">
          <Badge tone="gold" dot pulse={!reducedMotion} className="self-start">
            Private beta · welcome
          </Badge>

          <EarnSays size={56} reducedMotion={reducedMotion} line={greeting} />

          <p className="max-w-md text-[13.5px] leading-7 text-fg-3">
            You&apos;re in. Take a quick look around if you like, then I&apos;ll help you set up
            your profile and put the right specialists on call.
          </p>

          <div className="flex flex-wrap items-center gap-2.5">
            <button type="button" onClick={enter} disabled={entering} className={PRIMARY_BTN}>
              {entering ? 'Taking you in…' : 'Build my profile'}
              {!entering && <ArrowRight size={15} strokeWidth={2} aria-hidden />}
            </button>
            <Chip
              icon={Compass}
              active={showTour}
              onClick={() => {
                setShowTour((v) => !v);
                if (!showTour) ev('beta_invite_welcome_tour', { topic });
              }}
            >
              {showTour ? 'Hide the tour' : 'Show me around'}
            </Chip>
          </div>

          {showTour && (
            <div className="fx-rise flex flex-col gap-4 rounded-2xl border border-hairline bg-surface-1/70 p-4">
              <EarnSays line={BREAKDOWN[topic]} reducedMotion={reducedMotion} />
              <div className="flex flex-wrap gap-2">
                <Chip icon={Compass} active={topic === 'intro'} onClick={() => setTopic('intro')}>
                  What it is
                </Chip>
                <Chip icon={Users} active={topic === 'team'} onClick={() => setTopic('team')}>
                  Meet the team
                </Chip>
                <Chip
                  icon={ShieldCheck}
                  active={topic === 'value'}
                  onClick={() => setTopic('value')}
                >
                  What I get
                </Chip>
              </div>
              {topic === 'team' && (
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                  {TEAM_ROSTER.slice(0, 9).map((m) => (
                    <div
                      key={m.slug}
                      className="flex items-center gap-2.5 rounded-xl border border-hairline bg-surface-1 p-2.5"
                    >
                      <TeamAvatar member={m} size={30} className="flex-none" />
                      <div className="min-w-0">
                        <div className="truncate text-[12px] font-semibold text-fg-1">{m.name}</div>
                        <div className="truncate text-[10px] uppercase tracking-[0.08em] text-azure-1">
                          {m.position}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          <p className="text-[11px] text-fg-5">
            Takes about two minutes · you can edit anything later.
          </p>
        </div>
      </div>
    </main>
  );
}
