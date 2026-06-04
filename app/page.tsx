import Link from 'next/link';
import { ArrowRight, ListChecks, ShieldCheck, GitBranch } from 'lucide-react';
import { Card } from '@/components/ui';
import { EarnCoin } from '@/components/screens/EarnCoin';

const FEATURES = [
  {
    icon: ListChecks,
    title: 'AI Copilot task manager',
    body: 'Earn turns inbound signal into prioritized, auditable next actions across your pipeline.'
  },
  {
    icon: ShieldCheck,
    title: 'Chain of Trust',
    body: 'Proof of Truth → Concept → Execution → Work. Progress is event-sourced and one glance away.'
  },
  {
    icon: GitBranch,
    title: 'Capital-formation pipeline',
    body: 'Deals, allocations, and partnerships move from sourcing to close with warm-connection intelligence.'
  }
];

// Institutional blue primary CTA (gradient + soft glow), per the design system.
const CTA =
  'inline-flex items-center gap-2 rounded-xl bg-[linear-gradient(135deg,#3B74F0,#2152D8)] px-4 py-2 text-sm font-medium text-white shadow-[0_1px_2px_rgba(0,0,0,0.2),0_8px_18px_-8px_rgba(37,99,235,0.55)] transition hover:brightness-110';

export default function HomePage() {
  return (
    <main className="min-h-screen bg-bg-0 text-fg-1">
      <header className="mx-auto flex max-w-[1180px] items-center justify-between px-6 py-5">
        <span className="text-sm font-semibold tracking-tight">FundExecs OS</span>
        <Link href="/login" className={CTA}>
          Sign in
          <ArrowRight size={15} strokeWidth={1.9} aria-hidden />
        </Link>
      </header>

      <section className="mx-auto max-w-[1180px] px-6 pb-24 pt-16">
        <div className="inline-flex items-center gap-2 rounded-full border border-hairline bg-surface-1 px-3 py-1.5 text-[10.5px] font-semibold uppercase tracking-[0.11em] text-fg-4">
          AI-native private-market command center
        </div>

        <h1 className="mt-6 max-w-3xl text-[44px] font-semibold leading-[1.05] tracking-[-0.02em] md:text-6xl">
          Turn any fund into an execution machine.
        </h1>
        <p className="mt-5 max-w-2xl text-[15px] leading-7 text-fg-3">
          FundExecs OS streamlines workflows, accelerates decisions, and levels up operators — so
          emerging managers scale like top-tier institutions without adding headcount or friction.
        </p>

        <div className="mt-8 flex flex-wrap items-center gap-x-4 gap-y-3">
          <Link href="/login" className={CTA}>
            Get started
            <ArrowRight size={15} strokeWidth={1.9} aria-hidden />
          </Link>
          <span className="flex items-center gap-2 text-[12.5px] text-fg-4">
            <EarnCoin size={20} />
            Meet Earn — your Private Market Assistant
          </span>
        </div>

        <div className="mt-16 grid gap-4 md:grid-cols-3">
          {FEATURES.map((f) => {
            const Icon = f.icon;
            return (
              <Card key={f.title} className="p-5">
                <div className="flex h-9 w-9 items-center justify-center rounded-xl border border-hairline bg-surface-2 text-accent">
                  <Icon size={17} strokeWidth={1.9} aria-hidden />
                </div>
                <p className="mt-3.5 text-[13.5px] font-semibold text-fg-1">{f.title}</p>
                <p className="mt-1.5 text-[12.5px] leading-6 text-fg-3">{f.body}</p>
              </Card>
            );
          })}
        </div>

        <div className="mt-16 flex flex-wrap items-center gap-x-8 gap-y-3 border-t border-hairline pt-8 text-[12px] text-fg-4 [font-feature-settings:'tnum']">
          <span>
            <span className="font-semibold text-fg-2">$612M+</span> capital tracked
          </span>
          <span>
            <span className="font-semibold text-fg-2">500+</span> relationships
          </span>
          <span>
            <span className="font-semibold text-fg-2">4-layer</span> Chain of Trust
          </span>
          <span>
            <span className="font-semibold text-fg-2">15</span> AI brains
          </span>
        </div>
      </section>
    </main>
  );
}
