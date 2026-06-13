'use client';

import { useState } from 'react';
import { ArrowRight, CheckCircle2, ChevronRight, Loader2, Sparkles } from 'lucide-react';
import Link from 'next/link';
import { EarnCoin } from '@/components/ui/EarnCoin';
import { Button } from '@/components/ui/Button';
import type { MemberType } from '@/lib/member-types';
import { cn } from '@/lib/utils';

interface Context {
  memberType: MemberType | null;
  objective: string | null;
  principal: string | null;
}

interface Question {
  id: string;
  text: string;
  options: { value: string; label: string; description: string }[];
}

interface Recommendation {
  title: string;
  why: string;
  href: string;
  surface: string;
  tone: 'gold' | 'azure' | 'success';
}

const QUESTIONS: Question[] = [
  {
    id: 'stage',
    text: 'Where are you in your current raise or deployment cycle?',
    options: [
      {
        value: 'pre',
        label: 'Pre-launch',
        description: 'Forming the fund or building the pipeline'
      },
      { value: 'active', label: 'Active raise', description: 'In market, taking LP meetings' },
      {
        value: 'deploying',
        label: 'Deploying capital',
        description: 'First close done, writing checks'
      },
      {
        value: 'managing',
        label: 'Managing portfolio',
        description: 'Focused on exits and LP relations'
      }
    ]
  },
  {
    id: 'bottleneck',
    text: 'What is the biggest constraint on your velocity right now?',
    options: [
      {
        value: 'pipeline',
        label: 'Deal pipeline',
        description: 'Not enough quality opportunities'
      },
      { value: 'capital', label: 'Capital', description: 'LP commitments behind target' },
      {
        value: 'operations',
        label: 'Operations',
        description: 'Process and compliance slowing us down'
      },
      {
        value: 'relationships',
        label: 'Relationships',
        description: 'Need to warm the right people'
      }
    ]
  },
  {
    id: 'horizon',
    text: 'What is your most urgent time horizon?',
    options: [
      {
        value: 'this_week',
        label: 'This week',
        description: 'I have a meeting or deadline imminent'
      },
      {
        value: 'this_month',
        label: 'This month',
        description: 'Working toward a 30-day milestone'
      },
      {
        value: 'this_quarter',
        label: 'This quarter',
        description: 'Quarterly target is the focus'
      },
      { value: 'annual', label: 'Annual plan', description: 'Optimising for the year-end picture' }
    ]
  }
];

function deriveRecommendations(answers: Record<string, string>, ctx: Context): Recommendation[] {
  const recs: Recommendation[] = [];
  const stage = answers['stage'];
  const bottleneck = answers['bottleneck'];
  const horizon = answers['horizon'];

  if (bottleneck === 'pipeline' || stage === 'pre') {
    recs.push({
      title: 'Run a deal-sourcing sweep',
      why: 'Marcus scores inbound opportunities against your mandate before they reach your desk — a single sweep surfaces ranked targets with thesis fit.',
      href: '/source/pipeline',
      surface: 'Pipeline',
      tone: 'azure'
    });
  }
  if (bottleneck === 'capital' || stage === 'active') {
    recs.push({
      title: 'Open your capital map',
      why: 'Priya maps each opportunity to the most suitable LPs and co-investors in your network — sorted by fit, not recency.',
      href: '/source/capital-map',
      surface: 'Capital Map',
      tone: 'gold'
    });
  }
  if (bottleneck === 'relationships' || horizon === 'this_week') {
    recs.push({
      title: 'Warm your hottest connections',
      why: 'The desk tracks relationship temperature in real time — the top three warm contacts are ready to re-engage today.',
      href: '/source',
      surface: 'Source Hub',
      tone: 'success'
    });
  }
  if (bottleneck === 'operations' || stage === 'deploying') {
    recs.push({
      title: 'Run a compliance diligence sweep',
      why: 'Adrian flags structural risk before it reaches your desk — one run clears the backlog and keeps every engagement audit-ready.',
      href: '/run/diligence',
      surface: 'Diligence',
      tone: 'azure'
    });
  }
  if (stage === 'managing') {
    recs.push({
      title: 'Send a portfolio LP update',
      why: 'Eleanor drafts a structured LP update from your live portfolio data — keeps confidence high without the manual pull.',
      href: '/run/ir',
      surface: 'Investor Relations',
      tone: 'success'
    });
  }
  // Always add a catch-all
  if (recs.length < 2) {
    recs.push({
      title: 'Ask Earn for your top move',
      why: 'Earnest reviews the full desk state and surfaces the single highest-impact action you should take right now.',
      href: '/command-center',
      surface: 'Command Center',
      tone: 'gold'
    });
  }
  return recs.slice(0, 4);
}

const TONE_CLASSES: Record<Recommendation['tone'], string> = {
  gold: 'border-[var(--gold-line)] bg-[var(--gold-soft)] text-gold-1',
  azure: 'border-[var(--azure-line)] bg-[var(--azure-soft)] text-azure-1',
  success: 'border-[var(--success-line)] bg-[var(--success-soft)] text-success'
};

export function RecommendationsFlow({ context }: { context: Context }) {
  const [step, setStep] = useState(0);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [computing, setComputing] = useState(false);
  const [recommendations, setRecommendations] = useState<Recommendation[] | null>(null);

  const question = QUESTIONS[step];
  const totalSteps = QUESTIONS.length;
  const done = step >= totalSteps;

  function answer(value: string) {
    const next = { ...answers, [QUESTIONS[step].id]: value };
    setAnswers(next);
    if (step + 1 >= totalSteps) {
      setComputing(true);
      // Simulate brief compute (real: would hit an AI endpoint)
      setTimeout(() => {
        setRecommendations(deriveRecommendations(next, context));
        setComputing(false);
      }, 900);
      setStep(totalSteps);
    } else {
      setStep(step + 1);
    }
  }

  function reset() {
    setStep(0);
    setAnswers({});
    setRecommendations(null);
    setComputing(false);
  }

  if (computing) {
    return (
      <div className="flex flex-col items-center gap-4 rounded-2xl border border-hairline bg-bg-1 px-6 py-14 text-center">
        <EarnCoin size={40} online />
        <div className="flex items-center gap-2 text-[13.5px] text-fg-3">
          <Loader2 size={16} className="animate-spin" aria-hidden />
          Earn is reading the desk…
        </div>
      </div>
    );
  }

  if (recommendations) {
    return (
      <div className="flex flex-col gap-4">
        <div className="flex items-center gap-2.5 rounded-2xl border border-[var(--gold-line)] bg-[var(--gold-soft)] px-4 py-3">
          <EarnCoin size={24} />
          <p className="text-[12.5px] font-medium text-fg-1">
            Based on your answers — here&rsquo;s your ranked action plan.
          </p>
        </div>
        <div className="flex flex-col gap-3">
          {recommendations.map((r, i) => (
            <div
              key={r.href + i}
              className="flex items-start gap-3 rounded-2xl border border-hairline bg-bg-1 p-4"
            >
              <span
                className={cn(
                  'flex h-[30px] w-[30px] flex-none items-center justify-center rounded-[9px] border text-[12px] font-bold',
                  TONE_CLASSES[r.tone]
                )}
              >
                {i + 1}
              </span>
              <div className="min-w-0 flex-1">
                <div className="text-[13.5px] font-semibold text-fg-1">{r.title}</div>
                <p className="mt-0.5 text-[12px] leading-relaxed text-fg-3">{r.why}</p>
              </div>
              <Link
                href={r.href}
                className="inline-flex flex-none items-center gap-1 self-center rounded-lg border border-hairline px-2.5 py-1.5 text-[11.5px] font-semibold text-azure-1 transition hover:border-[var(--azure-line)] hover:bg-[var(--azure-soft)]"
              >
                {r.surface}
                <ArrowRight size={12} strokeWidth={2} aria-hidden />
              </Link>
            </div>
          ))}
        </div>
        <button
          type="button"
          onClick={reset}
          className="self-start text-[12.5px] text-fg-4 underline-offset-2 hover:text-fg-2 hover:underline"
        >
          Start over
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Progress */}
      <div className="flex items-center gap-3">
        <div className="flex flex-1 gap-1">
          {QUESTIONS.map((_, i) => (
            <div
              key={i}
              className={cn(
                'h-1 flex-1 rounded-full transition-colors',
                i < step ? 'bg-gold-1' : i === step ? 'bg-azure-1' : 'bg-surface-2'
              )}
            />
          ))}
        </div>
        <span className="text-[11px] text-fg-5 [font-feature-settings:'tnum']">
          {step + 1} / {totalSteps}
        </span>
      </div>

      {/* Question card */}
      <div className="rounded-2xl border border-hairline bg-bg-1 p-5">
        <div className="mb-1 flex items-center gap-2">
          <Sparkles size={15} className="text-gold-1" aria-hidden />
          <span className="text-[10.5px] font-semibold uppercase tracking-[0.11em] text-fg-4">
            Question {step + 1}
          </span>
        </div>
        <h2 className="mb-4 text-[15px] font-semibold tracking-[-0.01em] text-fg-1">
          {question?.text}
        </h2>
        <div className="flex flex-col gap-2">
          {question?.options.map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => answer(opt.value)}
              className="group flex items-center gap-3 rounded-xl border border-hairline bg-surface-1 px-4 py-3.5 text-left transition hover:border-[var(--azure-line)] hover:bg-[var(--azure-soft)]"
            >
              <CheckCircle2
                size={16}
                strokeWidth={1.9}
                className="flex-none text-fg-5 transition group-hover:text-azure-1"
                aria-hidden
              />
              <span className="min-w-0 flex-1">
                <span className="block text-[13.5px] font-semibold text-fg-1">{opt.label}</span>
                <span className="block text-[11.5px] text-fg-4">{opt.description}</span>
              </span>
              <ChevronRight
                size={15}
                className="flex-none text-fg-5 opacity-0 transition group-hover:opacity-100"
                aria-hidden
              />
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
