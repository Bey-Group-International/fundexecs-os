import Link from 'next/link';
import { BrainCircuit, FileSearch, ShieldCheck, Sparkles, ArrowRight } from 'lucide-react';
import { Badge, Card, SectionTitle } from '@/components/ui';
import { TeamAvatar, getSpecialists } from '@/lib/team';

/* ============================================================================
 * KnowledgeView — the Knowledge Base / RAG entry surface.
 *
 * The retrieval-augmented surface itself is Ask Earn (`/ask-earn`), which
 * queries the 15-specialist desk over your own documents and history. Rather
 * than an invisible redirect, this is a bold, on-brand landing that explains
 * what the knowledge base is, shows the desk that answers, and routes into the
 * live Ask Earn surface. Server component, tokens-only, read-only.
 * ========================================================================= */

const PILLARS: { icon: typeof FileSearch; title: string; body: string }[] = [
  {
    icon: FileSearch,
    title: 'Grounded in your record',
    body: 'Answers are retrieved from your own documents, deals, and history — not generic web text.'
  },
  {
    icon: BrainCircuit,
    title: 'Answered by the desk',
    body: 'Earn routes each question to the right specialist among the fifteen and synthesizes one answer.'
  },
  {
    icon: ShieldCheck,
    title: 'On the record',
    body: 'Every retrieval and response is audit-ready and captured in your Chain of Trust.'
  }
];

export function KnowledgeView() {
  const specialists = getSpecialists();

  return (
    <div className="mx-auto max-w-5xl space-y-6 px-4 py-8 sm:px-6">
      {/* Hero */}
      <Card className="relative overflow-hidden p-7">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 -z-10"
          style={{
            background:
              'radial-gradient(70% 130% at 0% 0%, rgba(91,141,239,0.09), transparent 60%), radial-gradient(60% 100% at 100% 0%, rgba(247,201,72,0.06), transparent 65%)'
          }}
        />
        <div className="flex flex-col gap-5 sm:flex-row sm:items-start">
          <span className="relative flex h-12 w-12 flex-none items-center justify-center rounded-2xl border border-hairline bg-bg-1 text-azure-1 shadow-[var(--shadow-sm)]">
            <BrainCircuit size={20} strokeWidth={1.9} aria-hidden />
          </span>
          <div className="min-w-0 flex-1">
            <p className="inline-flex items-center gap-1.5 text-[10.5px] font-semibold uppercase tracking-[0.16em] text-azure-1">
              <Sparkles size={11} strokeWidth={2} aria-hidden />
              Intelligence · Knowledge Base
            </p>
            <h1 className="mt-1 text-[24px] font-semibold tracking-[-0.018em] text-fg-1 sm:text-[28px]">
              Ask the desk, over your own record
            </h1>
            <p className="mt-2 max-w-[62ch] text-[13px] leading-relaxed text-fg-3">
              The knowledge base is your fifteen-specialist team, retrieval-augmented over your
              documents, deals, and history. Ask anything — Earn pulls the relevant context, routes
              to the right specialist, and answers with provenance.
            </p>
            <div className="mt-5 flex flex-wrap items-center gap-2">
              <Link
                href="/ask-earn"
                className="inline-flex items-center gap-1.5 rounded-xl border border-transparent bg-[var(--cta-gradient)] px-4 py-2 text-[13px] font-semibold text-white shadow-[var(--shadow-cta)] transition hover:brightness-110 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
              >
                Open Ask Earn
                <ArrowRight size={14} strokeWidth={2.2} aria-hidden />
              </Link>
              <Link
                href="/command-center"
                className="inline-flex items-center gap-1.5 rounded-xl border border-hairline bg-surface-1 px-4 py-2 text-[13px] font-semibold text-fg-2 transition hover:bg-surface-2 hover:text-fg-1 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold-1"
              >
                Back to dashboard
              </Link>
            </div>
          </div>
        </div>
      </Card>

      {/* Pillars */}
      <div className="grid gap-3 sm:grid-cols-3">
        {PILLARS.map((p) => {
          const Icon = p.icon;
          return (
            <Card key={p.title} className="flex flex-col gap-2.5 p-4">
              <span className="flex h-9 w-9 items-center justify-center rounded-xl border border-[var(--azure-line)] bg-[var(--azure-soft)] text-azure-1">
                <Icon size={16} strokeWidth={2} aria-hidden />
              </span>
              <h3 className="text-[13.5px] font-semibold text-fg-1">{p.title}</h3>
              <p className="text-[12px] leading-relaxed text-fg-4">{p.body}</p>
            </Card>
          );
        })}
      </div>

      {/* The desk */}
      <section aria-label="The specialist desk">
        <SectionTitle
          eyebrow="Who answers"
          title="Your fifteen-specialist desk"
          action={
            <Badge tone="neutral" className="text-[10.5px]">
              {specialists.length + 1} members
            </Badge>
          }
        />
        <Card className="p-4">
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-4">
            {specialists.map((m) => (
              <div
                key={m.slug}
                className="flex items-center gap-2.5 rounded-xl border border-hairline bg-bg-1 px-3 py-2.5"
              >
                <TeamAvatar member={m} size={32} />
                <div className="min-w-0">
                  <p className="truncate text-[12.5px] font-semibold text-fg-1">{m.name}</p>
                  <p className="truncate text-[10.5px] text-fg-4">{m.position}</p>
                </div>
              </div>
            ))}
          </div>
          <p className="mt-3 text-[11px] text-fg-5">
            Earnest Fundmaker (COO) fronts the desk and routes every question to the specialist best
            placed to answer.
          </p>
        </Card>
      </section>
    </div>
  );
}
