import type { LifecycleStage, ReadinessDimensionScore } from '@/lib/lifecycle';
import type { InvestorGroup } from '@/lib/onboarding/mandate';

/**
 * lib/hubs/lifecycle.ts — the lifecycle rail's pure vocabulary.
 *
 * The simplified prototype organizes the whole product around four universal
 * verbs — Build / Source / Run / Execute — rendered as one rail, a cockpit
 * strip on the Command Center, and a landing page per hub. This module owns
 * that vocabulary: hub identity, role-aware contents (what each member type
 * sees inside a verb), and the two derivations the shell needs — per-hub
 * readiness from the real readiness breakdown, and which hub is the
 * operator's center of gravity right now.
 *
 * Pure and React-free (icons are string names resolved by `MandateIcon`),
 * mirroring `lib/onboarding/mandate.ts`, so the shell, the cockpit, and unit
 * tests all read one spelling. IO lives in `lib/hubs/index.ts`.
 */

/* ============================================================================
 * Hub identity
 * ========================================================================= */

export type HubId = 'build' | 'source' | 'run' | 'execute';

export const HUB_IDS: readonly HubId[] = ['build', 'source', 'run', 'execute'] as const;

export interface HubMeta {
  id: HubId;
  label: string;
  /** Two-word framing shown next to the label ("Stand it up"). */
  tag: string;
  /** Icon name resolved via `MandateIcon`. */
  icon: string;
  href: `/${HubId}`;
}

export const HUB_META: readonly HubMeta[] = [
  { id: 'build', label: 'Build', tag: 'Stand it up', icon: 'blocks', href: '/build' },
  { id: 'source', label: 'Source', tag: 'Find & raise', icon: 'radar', href: '/source' },
  { id: 'run', label: 'Run', tag: 'Operate', icon: 'activity', href: '/run' },
  {
    id: 'execute',
    label: 'Execute',
    tag: 'Drive to close',
    icon: 'circle-check-big',
    href: '/execute'
  }
] as const;

export function hubMeta(id: HubId): HubMeta {
  return HUB_META.find((m) => m.id === id) ?? HUB_META[0];
}

/* ============================================================================
 * Role-aware contents — what each member type manages inside a verb
 * ========================================================================= */

/** One module tile on a hub landing (a surface the team manages there). */
export interface HubModule {
  label: string;
  /** Icon name resolved via `MandateIcon`. */
  icon: string;
  /** Who owns it / what it covers — honest attribution, never fake counts. */
  meta: string;
  /** Deep link once the module's interior is live; absent = "online next". */
  href?: string;
}

export interface HubContent {
  /** One-line promise of the hub for this member type. */
  blurb: string;
  modules: readonly HubModule[];
}

type HubContentMap = Record<HubId, HubContent>;

const FUND_HUBS: HubContentMap = {
  build: {
    blurb: 'Your fund, structured and ready to show.',
    modules: [
      {
        label: 'Fund formation',
        icon: 'landmark',
        meta: 'Adrian · copiloted filings',
        href: '/build/formation'
      },
      {
        label: 'Structure & governance',
        icon: 'scale',
        meta: 'Bodies & policies',
        href: '/build/governance'
      },
      {
        label: 'Materials & data room',
        icon: 'folder-lock',
        meta: 'Deck, one-pager, PPM',
        href: '/build/data-room'
      },
      {
        label: 'Profile & brand',
        icon: 'id-card',
        meta: 'Sienna · how you show up',
        href: '/build/brand'
      }
    ]
  },
  source: {
    blurb: 'The team finds your deals, capital and partners.',
    modules: [
      {
        label: 'Deal pipeline',
        icon: 'trending-up',
        meta: 'Marcus · on-thesis flow',
        href: '/source/pipeline'
      },
      {
        label: 'LP & capital targets',
        icon: 'handshake',
        meta: 'Sloane · fit + warmth',
        href: '/source/capital-map'
      },
      {
        label: 'Partners & providers',
        icon: 'briefcase',
        meta: 'The vetted bench',
        href: '/source/partners'
      },
      { label: 'Lead engine', icon: 'filter', meta: 'Camille · demand for portcos' }
    ]
  },
  run: {
    blurb: 'Operate the systems that move work forward.',
    modules: [
      {
        label: 'Diligence',
        icon: 'cpu',
        meta: 'Marcus · 7-agent verdicts',
        href: '/run/diligence'
      },
      { label: 'Workflows & tasks', icon: 'list-checks', meta: 'Sterling · sequenced' },
      { label: 'Compliance', icon: 'shield-check', meta: 'Adrian · counsel in the loop' },
      { label: 'IR & reporting', icon: 'users', meta: 'Eleanor · LP cadence' }
    ]
  },
  execute: {
    blurb: 'Drive every engagement to a signed close.',
    modules: [
      { label: 'Closings', icon: 'file-signature', meta: 'Step-gated to signature' },
      { label: 'Signatures & wires', icon: 'banknote', meta: 'Sign, wire, account' },
      { label: 'Capital calls', icon: 'receipt', meta: 'Drawdowns & distributions' },
      { label: 'Chain of Trust', icon: 'git-branch', meta: 'The 4-layer proof record' }
    ]
  }
};

const CAPITAL_HUBS: HubContentMap = {
  build: {
    blurb: 'Your mandate and allocation policy, set up.',
    modules: [
      { label: 'Mandate & criteria', icon: 'target', meta: 'Theodore · framed' },
      { label: 'Allocation policy', icon: 'pie-chart', meta: 'Risk & pacing' },
      { label: 'Diligence checklist', icon: 'list-checks', meta: 'The GP screen' },
      { label: 'Your profile', icon: 'id-card', meta: 'Confidential by default' }
    ]
  },
  source: {
    blurb: 'The team finds funds, deals and GPs that fit.',
    modules: [
      { label: 'Fund opportunities', icon: 'landmark', meta: 'Marcus · matched to mandate' },
      { label: 'Direct & co-invest deals', icon: 'radar', meta: 'On-thesis flow' },
      { label: 'GP relationships', icon: 'handshake', meta: 'Mapped & scored' },
      { label: 'Network', icon: 'users', meta: 'Warm paths in' }
    ]
  },
  run: {
    blurb: 'Monitor the portfolio and stay reported.',
    modules: [
      { label: 'Diligence', icon: 'cpu', meta: 'Theodore · GP screening' },
      { label: 'Portfolio monitoring', icon: 'activity', meta: 'NAV & pacing' },
      { label: 'Reporting & K-1s', icon: 'file-text', meta: 'Eleanor · tracked' },
      { label: 'Knowledge', icon: 'brain-circuit', meta: 'The 15 brains' }
    ]
  },
  execute: {
    blurb: 'Commit, subscribe and fund — on the record.',
    modules: [
      { label: 'Commitments', icon: 'file-signature', meta: 'Soft-circle to signed' },
      { label: 'Subscriptions & wires', icon: 'banknote', meta: 'Sign, wire, account' },
      { label: 'Capital calls', icon: 'receipt', meta: 'Drawdowns to fund' },
      { label: 'Chain of Trust', icon: 'git-branch', meta: 'The 4-layer proof record' }
    ]
  }
};

const SERVICE_HUBS: HubContentMap = {
  build: {
    blurb: 'Your practice, packaged to win mandates.',
    modules: [
      { label: 'Practice profile', icon: 'id-card', meta: 'Positioned to your market' },
      { label: 'Service offerings', icon: 'briefcase', meta: 'Scoped & priced' },
      { label: 'Materials & case studies', icon: 'folder-lock', meta: 'Sienna · proof of work' },
      { label: 'Brand presence', icon: 'globe', meta: 'Noah · organic visibility' }
    ]
  },
  source: {
    blurb: 'The team fills your funnel with the right work.',
    modules: [
      { label: 'Client pipeline', icon: 'trending-up', meta: 'Vivian · qualified leads' },
      { label: 'Deal flow', icon: 'radar', meta: 'From the network' },
      { label: 'Referral partners', icon: 'handshake', meta: 'Mapped & warmed' },
      { label: 'Lead engine', icon: 'filter', meta: 'Camille · top of funnel' }
    ]
  },
  run: {
    blurb: 'Run engagements and stay compliant.',
    modules: [
      { label: 'Engagements', icon: 'briefcase', meta: 'Active client work' },
      { label: 'Workflows & tasks', icon: 'list-checks', meta: 'Sterling · sequenced' },
      { label: 'Compliance', icon: 'shield-check', meta: 'Adrian · counsel in the loop' },
      { label: 'Knowledge', icon: 'brain-circuit', meta: 'The 15 brains' }
    ]
  },
  execute: {
    blurb: 'Win the mandate and get paid.',
    modules: [
      { label: 'Mandates won', icon: 'circle-check-big', meta: 'Signed engagements' },
      { label: 'Agreements & signatures', icon: 'file-signature', meta: 'Sign & countersign' },
      { label: 'Invoicing', icon: 'receipt', meta: 'Billed & collected' },
      { label: 'Chain of Trust', icon: 'git-branch', meta: 'The 4-layer proof record' }
    ]
  }
};

const HUBS_BY_GROUP: Record<InvestorGroup, HubContentMap> = {
  fund: FUND_HUBS,
  capital: CAPITAL_HUBS,
  service: SERVICE_HUBS
};

/** Role-aware hub contents; unknown groups read as the fund desk. */
export function hubContent(group: InvestorGroup, id: HubId): HubContent {
  return (HUBS_BY_GROUP[group] ?? FUND_HUBS)[id];
}

/* ============================================================================
 * Derivations — readiness per hub, and the operator's center of gravity
 * ========================================================================= */

const clamp100 = (n: number): number =>
  Number.isFinite(n) ? Math.max(0, Math.min(100, Math.round(n))) : 0;

/**
 * Map the five readiness dimensions (profile / proof / materials / pipeline /
 * capital — see `computeReadinessScore`) onto the four verbs:
 *
 * - **Build** is the record you stand up: profile + materials, evenly.
 * - **Source** is pipeline depth & momentum.
 * - **Run** is proof depth — the Chain-of-Trust read of how you operate.
 * - **Execute** is capital progress against the target.
 *
 * Derived from the same breakdown the readiness score uses, so the rail, the
 * cockpit, and the hub heroes can never disagree with the dashboard.
 */
export function hubReadiness(breakdown: readonly ReadinessDimensionScore[]): Record<HubId, number> {
  const dim = (d: ReadinessDimensionScore['dimension']): number =>
    breakdown.find((b) => b.dimension === d)?.score ?? 0;

  return {
    build: clamp100(dim('profile') * 0.5 + dim('materials') * 0.5),
    source: clamp100(dim('pipeline')),
    run: clamp100(dim('proof')),
    execute: clamp100(dim('capital'))
  };
}

/**
 * Which hub is the operator's center of gravity at a lifecycle stage — the
 * rail's "NOW" marker. Establishing truth and getting raise-ready are Build
 * work; sourcing LPs and deals is Source; operating is Run; converting LPs
 * (interest → commitment → close) and proving the record are Execute.
 */
export function centerHub(stage: LifecycleStage): HubId {
  switch (stage) {
    case 'establish_truth':
    case 'get_raise_ready':
      return 'build';
    case 'source_lps':
    case 'source_deals':
      return 'source';
    case 'operate':
      return 'run';
    case 'convert_lps':
    case 'prove':
      return 'execute';
  }
}
