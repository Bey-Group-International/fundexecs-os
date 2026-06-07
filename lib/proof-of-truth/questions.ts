import type { MemberType } from '@/lib/member-types';

/**
 * One question in the Proof of Truth flow. Earn asks these one at a time and
 * maps each answer to a profile field. `target` decides where the value lands:
 * a top-level `member_profiles` column, or a key inside the `details` JSON
 * (used for the member-type-specific fields).
 *
 * The same question set is the single source of truth for the Profile surface
 * (`/profile`): each question becomes a Profile section, and every unanswered
 * required question becomes a closeable gap. That keeps onboarding and the
 * Profile in lockstep — you can never see a gap you can't fill in onboarding.
 */
export interface ProfileQuestion {
  /** Stable id, unique within a member type's set. */
  id: string;
  /** Column name (target 'profile') or details key (target 'details'). */
  field: string;
  target: 'profile' | 'details';
  /** Short label shown above the field. */
  label: string;
  /** The question Earn asks, in plain language. */
  prompt: string;
  /** Input affordance for the Phase-3 UI. */
  kind: 'text' | 'textarea' | 'tags' | 'url' | 'select';
  placeholder?: string;
  /** Options for `kind: 'select'`. */
  options?: string[];
  /** When true, the member may skip this question without approving an answer. */
  optional?: boolean;
  /**
   * Why this field matters to a counterparty. Shown as onboarding context and
   * reused as the Profile gap reason, so the "why" is written once.
   */
  why?: string;
}

// Common questions every member answers (map to member_profiles columns).
const COMMON: ProfileQuestion[] = [
  {
    id: 'display_name',
    field: 'display_name',
    target: 'profile',
    label: 'Display name',
    prompt: 'What name should appear on your verified profile?',
    kind: 'text',
    placeholder: 'e.g. Northwind Capital',
    why: 'Your name is the first thing every counterparty sees — it anchors the record.'
  },
  {
    id: 'headline',
    field: 'headline',
    target: 'profile',
    label: 'Headline',
    prompt: 'In one line, how would you describe what you do?',
    kind: 'text',
    placeholder: 'A single, precise sentence',
    why: 'A sharp one-liner tells a counterparty whether to keep reading.'
  },
  {
    id: 'bio',
    field: 'bio',
    target: 'profile',
    label: 'Overview',
    prompt: 'Give a short overview a counterparty should read first.',
    kind: 'textarea',
    placeholder: 'Two or three sentences',
    why: 'The overview is your elevator pitch on the record — it frames everything else.'
  },
  {
    id: 'focus_areas',
    field: 'focus_areas',
    target: 'profile',
    label: 'Focus areas',
    prompt: 'What are your core focus areas?',
    kind: 'tags',
    placeholder: 'Add a few and press enter',
    why: 'Focus areas let the right counterparties find you and check fit at a glance.'
  },
  {
    id: 'linkedin',
    field: 'linkedin',
    target: 'details',
    label: 'LinkedIn',
    prompt: 'What is your LinkedIn URL? (optional)',
    kind: 'url',
    placeholder: 'https://linkedin.com/in/…',
    optional: true,
    why: 'A linked profile adds a verifiable identity signal.'
  },
  {
    id: 'website',
    field: 'website',
    target: 'details',
    label: 'Website',
    prompt: 'What is your website? (optional)',
    kind: 'url',
    placeholder: 'https://…',
    optional: true,
    why: 'A website gives counterparties somewhere credible to dig deeper.'
  }
];

// Member-type-specific questions (map to details.<field>).
const SPECIFIC: Record<MemberType, ProfileQuestion[]> = {
  investment_firm: [
    {
      id: 'firm_type',
      field: 'firm_type',
      target: 'details',
      label: 'Firm type',
      prompt: 'What kind of investment firm are you?',
      kind: 'select',
      options: [
        'Venture fund',
        'Growth fund',
        'Private equity',
        'Family office',
        'Fund of funds',
        'Other'
      ],
      why: 'Firm type sets the lens an LP reads the rest of your profile through.'
    },
    {
      id: 'check_size',
      field: 'check_size',
      target: 'details',
      label: 'Typical check size',
      prompt: 'What check size do you typically write?',
      kind: 'text',
      placeholder: 'e.g. $250K–$2M',
      why: 'Check size lets founders and co-investors judge fit before reaching out.'
    },
    {
      id: 'sectors',
      field: 'sectors',
      target: 'details',
      label: 'Sectors',
      prompt: 'Which sectors do you invest in?',
      kind: 'tags',
      why: 'Sectors are the first mandate-fit filter a counterparty applies.'
    },
    {
      id: 'stage_focus',
      field: 'stage_focus',
      target: 'details',
      label: 'Stage focus',
      prompt: 'What stages do you focus on?',
      kind: 'tags',
      placeholder: 'Pre-seed, Seed, Series A…',
      why: 'Stage focus tells founders whether the timing is right to engage.'
    },
    {
      id: 'thesis',
      field: 'thesis',
      target: 'details',
      label: 'Investment thesis',
      prompt: 'What is your investment thesis?',
      kind: 'textarea',
      why: 'LPs lead with "why now, why you" — a sharp thesis is table stakes.'
    }
  ],
  service_provider: [
    {
      id: 'service_category',
      field: 'service_category',
      target: 'details',
      label: 'Category',
      prompt: 'What category of service do you provide?',
      kind: 'select',
      options: [
        'Legal',
        'Accounting / Tax',
        'Fund administration',
        'Placement / Capital raising',
        'Marketing / PR',
        'Recruiting',
        'Technology',
        'Other'
      ],
      why: 'Category routes you to the counterparties actively looking for your service.'
    },
    {
      id: 'services_offered',
      field: 'services_offered',
      target: 'details',
      label: 'Services offered',
      prompt: 'Which specific services do you offer?',
      kind: 'tags',
      why: 'Specific services let clients match a need to exactly what you do.'
    },
    {
      id: 'ideal_client',
      field: 'ideal_client',
      target: 'details',
      label: 'Ideal client',
      prompt: 'Who is your ideal client?',
      kind: 'textarea',
      why: 'Naming your ideal client earns warmer, better-qualified introductions.'
    },
    {
      id: 'engagement_model',
      field: 'engagement_model',
      target: 'details',
      label: 'Engagement model',
      prompt: 'How do you typically engage?',
      kind: 'select',
      options: ['Retainer', 'Project-based', 'Success fee', 'Hourly', 'Other'],
      why: 'How you engage sets expectations before the first conversation.'
    }
  ],
  startup: [
    {
      id: 'sector',
      field: 'sector',
      target: 'details',
      label: 'Sector',
      prompt: 'What sector is your company in?',
      kind: 'tags',
      why: 'Sector is the first thing an investor checks against their mandate.'
    },
    {
      id: 'stage',
      field: 'stage',
      target: 'details',
      label: 'Stage',
      prompt: 'What stage are you at?',
      kind: 'select',
      options: ['Idea', 'Pre-seed', 'Seed', 'Series A', 'Series B+', 'Growth'],
      why: 'Stage tells investors whether you fit their entry point.'
    },
    {
      id: 'raising',
      field: 'raising',
      target: 'details',
      label: 'Raising',
      prompt: 'Are you raising, and on what terms?',
      kind: 'text',
      placeholder: 'e.g. $1.5M on a SAFE',
      why: 'Round size and terms let investors size their check and move quickly.'
    },
    {
      id: 'traction',
      field: 'traction',
      target: 'details',
      label: 'Traction',
      prompt: 'What traction can you point to?',
      kind: 'textarea',
      why: 'Traction is the evidence that turns interest into a meeting.'
    }
  ],
  student: [
    {
      id: 'institution',
      field: 'institution',
      target: 'details',
      label: 'Institution',
      prompt: 'Where do you study?',
      kind: 'text',
      why: 'Your institution is a credibility and network signal for mentors.'
    },
    {
      id: 'field_of_study',
      field: 'field_of_study',
      target: 'details',
      label: 'Field of study',
      prompt: 'What is your field of study?',
      kind: 'text',
      why: 'Field of study helps the right people place where you can contribute.'
    },
    {
      id: 'interest_area',
      field: 'interest_area',
      target: 'details',
      label: 'Interests',
      prompt: 'Which areas of private markets interest you most?',
      kind: 'tags',
      why: 'Interests connect you to relevant opportunities and conversations.'
    },
    {
      id: 'career_goal',
      field: 'career_goal',
      target: 'details',
      label: 'Career goal',
      prompt: 'What are you working toward?',
      kind: 'textarea',
      why: 'A clear goal lets mentors and firms know how to help you.'
    }
  ],
  individual_investor: [
    {
      id: 'investor_profile',
      field: 'investor_profile',
      target: 'details',
      label: 'Investor profile',
      prompt: 'How would you describe yourself as an investor?',
      kind: 'select',
      options: ['Angel', 'Limited partner', 'Syndicate lead', 'Operator-investor', 'Other'],
      why: 'Your investor profile sets how founders and leads should approach you.'
    },
    {
      id: 'check_size',
      field: 'check_size',
      target: 'details',
      label: 'Typical check size',
      prompt: 'What check size do you typically write?',
      kind: 'text',
      placeholder: 'e.g. $25K–$100K',
      why: 'Check size lets founders and syndicate leads judge fit instantly.'
    },
    {
      id: 'sectors',
      field: 'sectors',
      target: 'details',
      label: 'Sectors',
      prompt: 'Which sectors interest you?',
      kind: 'tags',
      why: 'Sectors are the first filter for surfacing relevant deals to you.'
    },
    {
      id: 'value_add',
      field: 'value_add',
      target: 'details',
      label: 'Value-add',
      prompt: 'Beyond capital, what do you bring?',
      kind: 'textarea',
      why: 'Value-add is what wins you allocation in competitive rounds.'
    }
  ]
};

/** The full ordered question set for a member type (common, then specific). */
export function getQuestionSet(memberType: MemberType): ProfileQuestion[] {
  return [...COMMON, ...SPECIFIC[memberType]];
}

/** The common questions every member answers, regardless of type. */
export function getCommonQuestions(): ProfileQuestion[] {
  return [...COMMON];
}

/** Look up one question by id within a member type's set. */
export function getQuestion(memberType: MemberType, id: string): ProfileQuestion | null {
  return getQuestionSet(memberType).find((q) => q.id === id) ?? null;
}
