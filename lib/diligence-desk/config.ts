/**
 * lib/diligence-desk/config.ts — Diligence Desk (Run) config (pure).
 *
 * Ported from the onboarding prototype's `run.jsx` diligence layer: the
 * multi-agent verdict surface where a panel of agents runs each workstream on a
 * deal, you review the findings, and you clear the open items toward an IC-ready
 * verdict. Distinct from the live diligence backend in `lib/diligence/*` — this
 * is the illustrative front-of-house desk (client-side, no IO) until that schema
 * surfaces here. Pure (no React, no IO) so it unit-tests cleanly.
 */

import type { BadgeTone } from '@/components/ui';

/** A diligence workstream's run status. */
export type DDStatus = 'clear' | 'caution' | 'flag' | 'pending';

/** Severity on an open (flag/caution) workstream. */
export type DDSeverity = 'High' | 'Medium' | 'Low';

/** One agent in the diligence panel (the workstream + who runs it). */
export interface DDAgent {
  id: string;
  name: string;
  /** lucide-ish icon name (resolved by the view). */
  icon: string;
  who: string;
}

/** The per-deal result of an agent's run. */
export interface DDAgentState {
  status: DDStatus;
  confidence: number;
  checks: number;
  headline: string;
  detail: string;
  severity?: DDSeverity;
  /** The copiloted next move when the workstream isn't clear. */
  action?: string;
  evidence: string[];
}

export interface DDDeal {
  name: string;
  sector: string;
  /** Equity amount in $M. */
  amt: number;
  agents: Record<string, DDAgentState>;
}

export const DD_AGENTS: readonly DDAgent[] = [
  { id: 'financial', name: 'Financial diligence', icon: 'calculator', who: 'Marcus' },
  { id: 'legal', name: 'Legal & contracts', icon: 'scale', who: 'Adrian' },
  { id: 'commercial', name: 'Commercial & market', icon: 'trending-up', who: 'Theodore' },
  { id: 'tech', name: 'Technology & IP', icon: 'cpu', who: 'Dalia' },
  { id: 'ops', name: 'Operations & team', icon: 'users', who: 'Sterling' },
  { id: 'esg', name: 'ESG & compliance', icon: 'leaf', who: 'Adrian' },
  { id: 'customer', name: 'Customer & references', icon: 'phone', who: 'Eleanor' }
];

export const DD_DEALS: Record<string, DDDeal> = {
  helios: {
    name: 'Helios Robotics',
    sector: 'Industrials',
    amt: 18,
    agents: {
      financial: {
        status: 'clear',
        confidence: 94,
        checks: 18,
        headline: 'Quality of earnings confirmed',
        detail: 'EBITDA bridge ties out; 2 small add-backs normalized. Net revenue retention 118%.',
        evidence: [
          '3yr audited financials',
          'QoE report (Whitfield)',
          'Bank statements',
          'AR/AP aging'
        ]
      },
      commercial: {
        status: 'clear',
        confidence: 88,
        checks: 12,
        headline: 'Market tailwind intact',
        detail: 'TAM growing 14%/yr; win rate up vs. two incumbents. Pipeline coverage 3.1x.',
        evidence: ['Market study', 'Win/loss analysis', 'Customer concentration']
      },
      tech: {
        status: 'clear',
        confidence: 91,
        checks: 15,
        headline: 'IP clean, stack modern',
        detail: '4 granted patents, no freedom-to-operate conflicts. Tech debt low.',
        evidence: ['Patent search', 'Code audit', 'Security scan', 'Architecture review']
      },
      ops: {
        status: 'caution',
        confidence: 76,
        checks: 11,
        severity: 'Low',
        headline: 'Key-person risk on CTO',
        detail:
          'Single point of failure on the CTO. Retention package in the LOI mitigates but does not eliminate.',
        action: 'Add CTO retention milestone',
        evidence: ['Org chart', 'Comp review', 'Tenure analysis']
      },
      esg: {
        status: 'clear',
        confidence: 90,
        checks: 9,
        headline: 'No material exposure',
        detail: 'Standard industrial profile; no sanctions or environmental liabilities.',
        evidence: ['Sanctions screen', 'Environmental review', 'Litigation search']
      },
      legal: {
        status: 'flag',
        confidence: 62,
        checks: 14,
        severity: 'High',
        headline: 'Change-of-control in top-2 contracts',
        detail:
          'Change-of-control clauses in the top-2 accounts (31% of revenue) require counterparty consent on close. Without consent, revenue is at risk.',
        action: 'Confirm consent path',
        evidence: ['Top-10 customer contracts', 'Cap table', 'Corporate records']
      },
      customer: {
        status: 'flag',
        confidence: 70,
        checks: 6,
        severity: 'Medium',
        headline: 'Largest account reference pending',
        detail:
          '5 of 6 references strongly positive. The 6th (largest account, 19% of revenue) has not responded — Eleanor is chasing.',
        action: 'Chase final reference',
        evidence: ['5 completed reference calls', 'NPS data']
      }
    }
  },
  cedar: {
    name: 'Cedar Roll-up',
    sector: 'Consumer',
    amt: 24,
    agents: {
      financial: {
        status: 'clear',
        confidence: 89,
        checks: 16,
        headline: 'Roll-up economics hold',
        detail:
          'Pro-forma combined EBITDA validated across 3 targets; synergy assumptions conservative.',
        evidence: ['Combined P&L', 'Synergy model', 'Working capital review']
      },
      commercial: {
        status: 'caution',
        confidence: 74,
        checks: 10,
        severity: 'Medium',
        headline: 'Fragmentation thesis intact, integration risk',
        detail: 'Market is fragmented as expected, but integrating 3 teams carries execution risk.',
        action: 'Stress the integration plan',
        evidence: ['Market map', 'Target overlap analysis']
      },
      tech: {
        status: 'clear',
        confidence: 82,
        checks: 8,
        headline: 'Systems consolidation feasible',
        detail: 'Common ERP path identified; 6-month consolidation timeline.',
        evidence: ['Systems audit']
      },
      ops: {
        status: 'flag',
        confidence: 58,
        checks: 12,
        severity: 'High',
        headline: 'Two founders exiting at close',
        detail:
          'Both lead-target founders plan to exit at close. Management gap must be filled before signing.',
        action: 'Line up interim leadership',
        evidence: ['Org charts', 'Founder interviews', 'Retention analysis']
      },
      esg: {
        status: 'clear',
        confidence: 86,
        checks: 7,
        headline: 'Clean across targets',
        detail: 'No material ESG flags across the three businesses.',
        evidence: ['Sanctions screen', 'Litigation search']
      },
      legal: {
        status: 'clear',
        confidence: 84,
        checks: 13,
        headline: 'Clean cap tables',
        detail: 'All three targets have clean ownership; no change-of-control issues.',
        evidence: ['Cap tables', 'Customer contracts']
      },
      customer: {
        status: 'caution',
        confidence: 78,
        checks: 9,
        severity: 'Low',
        headline: 'Overlapping customers',
        detail: 'Some customer overlap across targets — modest concentration once combined.',
        action: 'Confirm post-merger concentration',
        evidence: ['Customer lists', 'Reference calls']
      }
    }
  },
  nova: {
    name: 'Nova AI',
    sector: 'AI & Software',
    amt: 12,
    agents: {
      financial: {
        status: 'clear',
        confidence: 80,
        checks: 11,
        headline: 'Strong unit economics',
        detail: 'Gross margin 82%, efficient growth, 14-month CAC payback.',
        evidence: ['SaaS metrics', 'Cohort analysis']
      },
      commercial: {
        status: 'clear',
        confidence: 85,
        checks: 9,
        headline: 'Category leader emerging',
        detail: 'Differentiated vertical AI; strong logos and expansion revenue.',
        evidence: ['Win/loss', 'Logo review']
      },
      tech: {
        status: 'flag',
        confidence: 60,
        checks: 14,
        severity: 'High',
        headline: 'Model dependency on third-party LLM',
        detail:
          'Core product depends on a single external model provider — concentration and cost risk.',
        action: 'Assess model portability',
        evidence: ['Architecture review', 'Vendor contracts', 'Cost analysis']
      },
      ops: {
        status: 'caution',
        confidence: 72,
        checks: 8,
        severity: 'Medium',
        headline: 'Hiring plan ambitious',
        detail: 'Plan assumes aggressive engineering hires in a tight market.',
        action: 'Pressure-test the hiring plan',
        evidence: ['Headcount plan', 'Comp benchmarks']
      },
      esg: {
        status: 'pending',
        confidence: 0,
        checks: 2,
        headline: 'AI governance review running',
        detail: 'Adrian is reviewing data-use, bias and AI-governance exposure.',
        evidence: ['In progress']
      },
      legal: {
        status: 'clear',
        confidence: 83,
        checks: 10,
        headline: 'IP assigned, clean',
        detail: 'All IP properly assigned; standard customer terms.',
        evidence: ['IP assignments', 'Contracts']
      },
      customer: {
        status: 'pending',
        confidence: 0,
        checks: 1,
        headline: 'Reference calls scheduling',
        detail: 'Eleanor is scheduling 6 customer reference calls.',
        evidence: ['In progress']
      }
    }
  }
};

export interface DDDealMeta {
  id: string;
  label: string;
  sub: string;
}

export const DD_DEAL_META: readonly DDDealMeta[] = [
  { id: 'helios', label: 'Helios Robotics', sub: 'Industrials · $18M' },
  { id: 'cedar', label: 'Cedar Roll-up', sub: 'Consumer · $24M' },
  { id: 'nova', label: 'Nova AI', sub: 'AI & Software · $12M' }
];

export interface DDStatusMeta {
  tone: BadgeTone;
  label: string;
  /** lucide-ish icon name (resolved by the view). */
  icon: string;
}

export const DD_STATUS: Record<DDStatus, DDStatusMeta> = {
  clear: { tone: 'success', label: 'Clear', icon: 'check-circle-2' },
  caution: { tone: 'info', label: 'Caution', icon: 'info' },
  flag: { tone: 'warning', label: 'Needs review', icon: 'alert-triangle' },
  pending: { tone: 'neutral', label: 'Running', icon: 'loader' }
};

/** Severity → tone for the register chips and badges. */
export const DD_SEV_TONE: Record<DDSeverity, BadgeTone> = {
  High: 'danger',
  Medium: 'warning',
  Low: 'info'
};

/** A deal's diligence agent map. */
export type DDAgentMap = Record<string, DDAgentState>;

/** A fresh, mutable copy of a deal's agent map (so the flow can clear items). */
export function dealAgentsCopy(deal: DDDeal): DDAgentMap {
  const out: DDAgentMap = {};
  for (const a of DD_AGENTS) {
    const st = deal.agents[a.id];
    if (st) out[a.id] = { ...st, evidence: [...st.evidence] };
  }
  return out;
}

/** The open (flag/caution) workstreams, in panel order. */
export function openAgents(agents: DDAgentMap): DDAgent[] {
  return DD_AGENTS.filter((a) => {
    const s = agents[a.id]?.status;
    return s === 'flag' || s === 'caution';
  });
}

export interface DealReadiness {
  cleared: number;
  total: number;
  pct: number;
  avgConfidence: number;
  totalChecks: number;
}

/** Roll up a deal's readiness: cleared workstreams, avg confidence, checks run. */
export function dealReadiness(agents: DDAgentMap): DealReadiness {
  const total = DD_AGENTS.length;
  const cleared = DD_AGENTS.filter((a) => agents[a.id]?.status === 'clear').length;
  const confSum = DD_AGENTS.reduce((s, a) => s + (agents[a.id]?.confidence ?? 0), 0);
  const totalChecks = DD_AGENTS.reduce((s, a) => s + (agents[a.id]?.checks ?? 0), 0);
  return {
    cleared,
    total,
    pct: total > 0 ? Math.round((cleared / total) * 100) : 0,
    avgConfidence: total > 0 ? Math.round(confSum / total) : 0,
    totalChecks
  };
}

export interface DDVerdict {
  label: string;
  tone: BadgeTone;
  note: string;
}

/**
 * The IC verdict, escalating worst-first: a high-severity flag puts the deal on
 * hold; any flag is a conditional pass; a remaining caution is a pass-with-notes;
 * otherwise it's clear to proceed.
 */
export function deriveVerdict(agents: DDAgentMap): DDVerdict {
  const flags = DD_AGENTS.filter((a) => agents[a.id]?.status === 'flag');
  const highFlags = flags.filter((a) => agents[a.id]?.severity === 'High').length;
  const open = openAgents(agents);
  if (highFlags > 0) {
    return {
      label: 'On hold',
      tone: 'danger',
      note: `${highFlags} high-severity item${highFlags > 1 ? 's' : ''} to resolve`
    };
  }
  if (flags.length > 0) {
    return {
      label: 'Conditional pass',
      tone: 'warning',
      note: `${flags.length} open item${flags.length > 1 ? 's' : ''} before IC`
    };
  }
  if (open.length > 0) {
    return {
      label: 'Pass with notes',
      tone: 'info',
      note: `${open.length} caution${open.length > 1 ? 's' : ''} logged`
    };
  }
  return { label: 'Clear to proceed', tone: 'success', note: 'IC-ready' };
}

/** A deal is IC-ready once nothing is flagged or in caution. */
export function icReady(agents: DDAgentMap): boolean {
  return openAgents(agents).length === 0;
}

export interface RiskRow {
  agentId: string;
  name: string;
  severity: DDSeverity;
  headline: string;
}

const SEV_RANK: Record<DDSeverity, number> = { High: 0, Medium: 1, Low: 2 };

/** The risk register: open workstreams, worst severity first. */
export function riskRegister(agents: DDAgentMap): RiskRow[] {
  return openAgents(agents)
    .map((a) => {
      const st = agents[a.id];
      return {
        agentId: a.id,
        name: a.name,
        severity: st.severity ?? 'Low',
        headline: st.headline
      };
    })
    .sort((x, y) => SEV_RANK[x.severity] - SEV_RANK[y.severity]);
}

/** The (illustrative) steps shown while Earn resolves an open workstream. */
export function resolveSteps(agent: DDAgent, state: DDAgentState): string[] {
  return [
    `Pull ${agent.who}'s findings`,
    state.action ?? 'Confirm the open item',
    'Update the diligence record',
    'Log evidence to Chain of Trust'
  ];
}

/** Pure transform: clear an open workstream (lifts confidence, drops severity). */
export function resolveAgent(state: DDAgentState): DDAgentState {
  return {
    ...state,
    status: 'clear',
    confidence: Math.max(state.confidence || 80, 90),
    headline: state.headline.startsWith('Resolved — ')
      ? state.headline
      : `Resolved — ${state.headline}`,
    severity: undefined,
    action: undefined
  };
}
