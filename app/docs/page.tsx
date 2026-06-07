import type { Metadata } from 'next';
import Link from 'next/link';
import { Boxes, Layers, ShieldCheck } from 'lucide-react';
import { AccountPageShell } from '@/components/account/AccountPageShell';

export const metadata: Metadata = {
  title: 'Documentation',
  description: 'How FundExecs OS works — the desk, the Chain of Trust, and the agents.'
};

const TRUST_LAYERS = [
  {
    name: 'Identity',
    body: 'Who acted — the authenticated operator and their role in the workspace.'
  },
  {
    name: 'Source',
    body: 'What it’s grounded in — the documents, records, and data behind the work.'
  },
  { name: 'Execution', body: 'What was done — the action taken, captured as a verifiable step.' },
  {
    name: 'Outcome',
    body: 'What resulted — the proof that advances a deal or task from pending to approved.'
  }
];

/**
 * The agent roster. Titles mirror the seeded BGI brain set (`lib/ai/brains.ts`)
 * plus Earn, the operator-facing COO that orchestrates them — 15 in total.
 */
const AGENTS: { name: string; role: string }[] = [
  { name: 'Earn (COO)', role: 'Operator-facing concierge that orchestrates the whole desk.' },
  { name: 'Master Workflow', role: 'Command layer — routes each request to the right agent.' },
  { name: 'Earnest Fundmaker', role: 'Showrunner that surfaces the day’s highest-impact actions.' },
  { name: 'Automater / Scrubber', role: 'Intake & data hygiene — clean, structured records.' },
  { name: 'Executive Advisor', role: 'Investor intelligence and strategy guidance.' },
  { name: 'Rainmaker', role: 'The closer — drives commitments and deal closes.' },
  { name: 'Deal Sourcer', role: 'Acquisitions — sources and screens proprietary deal flow.' },
  { name: 'Capital Connector', role: 'Financing — matches deals to the right capital.' },
  { name: 'Legal / Admin', role: 'Compliance, fund docs, KYC/AML, and the evidence trail.' },
  { name: 'PR Director', role: 'Materials & narrative in the fund voice.' },
  { name: 'SEO Disruptor', role: 'Search and discovery growth.' },
  { name: 'Lead Generator', role: 'Targeted outreach funnels for the pipeline.' },
  { name: 'Private Event Curator', role: 'Warm introductions through curated events.' },
  { name: 'Investor Relations', role: 'LP communication, updates, and re-up cadence.' },
  { name: 'Elite Capital Raiser', role: 'Leads institutional raises end to end.' },
  { name: 'Workflow Instructor', role: 'Enablement — teaches the FundExecs OS workflows.' }
];

const SECTIONS = [
  {
    id: 'desk',
    icon: Layers,
    title: 'The desk',
    body: 'FundExecs OS is an operating desk for emerging managers. The side rail organizes work into six logic areas — Source of Truth, Capital Formation, Diligence, Decisions, Relationships, and Operations — and auto-expands the compartment that matches your current lifecycle stage. The Command Center is your home surface; specialized screens (Pipeline, Diligence, IC Memos, LP Room, Capital Stack) handle each stage of the private-market lifecycle.',
    links: [
      { href: '/command-center', label: 'Command Center' },
      { href: '/pipeline', label: 'Pipeline' },
      { href: '/diligence', label: 'Diligence' },
      { href: '/capital-stack', label: 'Capital Stack' }
    ]
  }
];

export default function DocsPage() {
  return (
    <AccountPageShell
      eyebrow="Documentation"
      title="How FundExecs OS works"
      intro="A working operating desk for emerging managers: a Chain of Trust under every material action, and a team of agents that does the back-office work. Start here."
    >
      <div className="space-y-12">
        {/* The desk */}
        {SECTIONS.map((section) => {
          const Icon = section.icon;
          return (
            <section key={section.id}>
              <div className="flex items-center gap-2">
                <Icon size={18} strokeWidth={1.9} aria-hidden className="text-gold-1" />
                <h2 className="text-[18px] font-semibold tracking-tight text-fg-1">
                  {section.title}
                </h2>
              </div>
              <p className="mt-3 max-w-3xl text-[13.5px] leading-7 text-fg-3">{section.body}</p>
              <div className="mt-4 flex flex-wrap gap-2">
                {section.links.map((l) => (
                  <Link
                    key={l.href}
                    href={l.href}
                    className="rounded-lg border border-hairline bg-surface-1 px-3 py-1.5 text-[12.5px] text-fg-2 transition hover:bg-surface-2 hover:text-fg-1"
                  >
                    {l.label}
                  </Link>
                ))}
              </div>
            </section>
          );
        })}

        {/* Chain of Trust */}
        <section>
          <div className="flex items-center gap-2">
            <ShieldCheck size={18} strokeWidth={1.9} aria-hidden className="text-gold-1" />
            <h2 className="text-[18px] font-semibold tracking-tight text-fg-1">Chain of Trust</h2>
          </div>
          <p className="mt-3 max-w-3xl text-[13.5px] leading-7 text-fg-3">
            Every material action on the desk carries a verifiable trust trail across four layers.
            As each layer is satisfied, work advances from pending to approved — so the output is
            auditable rather than opaque. Trust toasts surface this verification as it happens.
          </p>
          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {TRUST_LAYERS.map((layer, i) => (
              <div key={layer.name} className="rounded-2xl border border-hairline bg-surface-1 p-4">
                <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-fg-4">
                  Layer {i + 1}
                </span>
                <h3 className="mt-1 text-[14px] font-semibold text-fg-1">{layer.name}</h3>
                <p className="mt-1 text-[12.5px] leading-6 text-fg-3">{layer.body}</p>
              </div>
            ))}
          </div>
          <div className="mt-4">
            <Link
              href="/trust"
              className="rounded-lg border border-hairline bg-surface-1 px-3 py-1.5 text-[12.5px] text-fg-2 transition hover:bg-surface-2 hover:text-fg-1"
            >
              Open the Trust center
            </Link>
          </div>
        </section>

        {/* The agents */}
        <section>
          <div className="flex items-center gap-2">
            <Boxes size={18} strokeWidth={1.9} aria-hidden className="text-gold-1" />
            <h2 className="text-[18px] font-semibold tracking-tight text-fg-1">The 15 agents</h2>
          </div>
          <p className="mt-3 max-w-3xl text-[13.5px] leading-7 text-fg-3">
            Earn is the operator-facing COO; behind it, a roster of specialized agents handles each
            part of running the fund. You delegate from anywhere via the Earn dock, and the Master
            Workflow routes the request to the right specialist.
          </p>
          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {AGENTS.map((agent) => (
              <div key={agent.name} className="rounded-2xl border border-hairline bg-surface-1 p-4">
                <h3 className="text-[13.5px] font-semibold text-fg-1">{agent.name}</h3>
                <p className="mt-1 text-[12px] leading-6 text-fg-3">{agent.role}</p>
              </div>
            ))}
          </div>
        </section>
      </div>
    </AccountPageShell>
  );
}
