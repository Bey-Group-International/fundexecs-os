/* ============================================================================
 * lib/strategy/playbook.ts — stage-tuned objective templates (the seasoned-exec
 * seed).
 *
 * Phase 2b/5 of memory/STRATEGY_COMPOUNDING_BLUEPRINT.md, decision #3 ("operate
 * like a seasoned investment-firm executive"): for each lifecycle stage, the
 * moves a veteran GP would run, owned by the specialist whose domain it is. The
 * `draftStrategyObjectives` action instantiates these as pending drafts routed
 * into the team-review inbox, so a first-timer gets a veteran's plan to approve
 * rather than a blank page. Pure data + a lookup; unit-tested.
 * ========================================================================= */

import type { LifecycleStage } from '@/lib/lifecycle';

export interface PlaybookTemplate {
  /** 100 / 30 / 10 horizon the move belongs to. */
  tier: '100' | '30' | '10';
  title: string;
  /** Human-readable target window, mirrors the manual objective `timeline`. */
  timeline: string;
  priority: 'high' | 'medium' | 'low';
  /** Posture lane the objective rolls up into. */
  category: 'capital' | 'governance' | 'compliance' | 'execution';
  /** Roster slug (lib/team/roster.ts) of the specialist who owns this move. */
  ownerSlug: string;
}

/**
 * The veteran's plan, by stage. Two-to-three moves per stage spanning the
 * 100/30/10 horizons, each routed to the specialist whose mandate it is. Kept
 * deliberately small and deterministic — no AI on the drafting path — so the
 * inbox is instant and free; richer signal-driven drafts layer on top later.
 */
export const STAGE_PLAYBOOK: Record<LifecycleStage, PlaybookTemplate[]> = {
  establish_truth: [
    {
      tier: '100',
      title: 'Lock the fund thesis into a one-page strategy memo',
      timeline: 'Next 100 days',
      priority: 'high',
      category: 'compliance',
      ownerSlug: 'executive-advisor'
    },
    {
      tier: '30',
      title: 'Document the track record with verifiable proof points',
      timeline: 'Next 30 days',
      priority: 'high',
      category: 'compliance',
      ownerSlug: 'legal-admin'
    },
    {
      tier: '10',
      title: 'Define team roles and a lightweight governance charter',
      timeline: 'Next 10 days',
      priority: 'medium',
      category: 'governance',
      ownerSlug: 'legal-admin'
    }
  ],
  get_raise_ready: [
    {
      tier: '100',
      title: 'Assemble the institutional data room (DDQ, deck, model)',
      timeline: 'Next 100 days',
      priority: 'high',
      category: 'governance',
      ownerSlug: 'executive-advisor'
    },
    {
      tier: '30',
      title: 'Stand up fund formation and the compliance checklist',
      timeline: 'Next 30 days',
      priority: 'high',
      category: 'compliance',
      ownerSlug: 'legal-admin'
    },
    {
      tier: '10',
      title: 'Finalize fund terms and fee structure',
      timeline: 'Next 10 days',
      priority: 'medium',
      category: 'capital',
      ownerSlug: 'capital-connector'
    }
  ],
  source_lps: [
    {
      tier: '100',
      title: 'Build a targeted universe of 50 qualified LP prospects',
      timeline: 'Next 100 days',
      priority: 'high',
      category: 'capital',
      ownerSlug: 'investor-relations'
    },
    {
      tier: '30',
      title: 'Segment LPs by mandate fit and warm-intro path',
      timeline: 'Next 30 days',
      priority: 'medium',
      category: 'capital',
      ownerSlug: 'capital-connector'
    },
    {
      tier: '10',
      title: 'Launch the first outreach wave with tailored materials',
      timeline: 'Next 10 days',
      priority: 'high',
      category: 'capital',
      ownerSlug: 'investor-relations'
    }
  ],
  convert_lps: [
    {
      tier: '100',
      title: 'Move ten soft-circles to signed commitments',
      timeline: 'Next 100 days',
      priority: 'high',
      category: 'capital',
      ownerSlug: 'capital-raiser'
    },
    {
      tier: '30',
      title: 'Run LP diligence calls and reference checks',
      timeline: 'Next 30 days',
      priority: 'high',
      category: 'capital',
      ownerSlug: 'investor-relations'
    },
    {
      tier: '10',
      title: 'Close the first anchor commitment',
      timeline: 'Next 10 days',
      priority: 'high',
      category: 'capital',
      ownerSlug: 'capital-raiser'
    }
  ],
  source_deals: [
    {
      tier: '100',
      title: 'Build a proprietary deal pipeline against the thesis',
      timeline: 'Next 100 days',
      priority: 'high',
      category: 'execution',
      ownerSlug: 'deal-sourcer'
    },
    {
      tier: '30',
      title: 'Stand up the diligence and IC-memo workflow',
      timeline: 'Next 30 days',
      priority: 'high',
      category: 'governance',
      ownerSlug: 'executive-advisor'
    },
    {
      tier: '10',
      title: 'Deploy the first allocation with a full audit trail',
      timeline: 'Next 10 days',
      priority: 'high',
      category: 'execution',
      ownerSlug: 'deal-sourcer'
    }
  ],
  operate: [
    {
      tier: '100',
      title: 'Convert market signals into portfolio actions weekly',
      timeline: 'Next 100 days',
      priority: 'medium',
      category: 'execution',
      ownerSlug: 'deal-sourcer'
    },
    {
      tier: '30',
      title: 'Institutionalize knowledge reuse across deals',
      timeline: 'Next 30 days',
      priority: 'medium',
      category: 'execution',
      ownerSlug: 'executive-advisor'
    },
    {
      tier: '10',
      title: 'Run the quarterly LP reporting cadence',
      timeline: 'Next 10 days',
      priority: 'medium',
      category: 'governance',
      ownerSlug: 'investor-relations'
    }
  ],
  prove: [
    {
      tier: '100',
      title: 'Publish a verifiable, audit-ready track-record record',
      timeline: 'Next 100 days',
      priority: 'medium',
      category: 'compliance',
      ownerSlug: 'legal-admin'
    },
    {
      tier: '30',
      title: 'Make every recurring action auditable and reusable',
      timeline: 'Next 30 days',
      priority: 'medium',
      category: 'governance',
      ownerSlug: 'legal-admin'
    },
    {
      tier: '10',
      title: "Compound proof into the next fund's raise narrative",
      timeline: 'Next 10 days',
      priority: 'medium',
      category: 'capital',
      ownerSlug: 'capital-connector'
    }
  ]
};

/** The veteran moves for a stage (empty array if the stage is unknown). */
export function playbookForStage(stage: LifecycleStage): PlaybookTemplate[] {
  return STAGE_PLAYBOOK[stage] ?? [];
}
