import type { MemberType } from '@/lib/member-types';

/**
 * One question in the Proof of Truth flow. Earn asks these one at a time and
 * maps each answer to a profile field. `target` decides where the value lands:
 * a top-level `member_profiles` column, or a key inside the `details` JSON
 * (used for the member-type-specific fields).
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
    placeholder: 'e.g. Northwind Capital'
  },
  {
    id: 'headline',
    field: 'headline',
    target: 'profile',
    label: 'Headline',
    prompt: 'In one line, how would you describe what you do?',
    kind: 'text',
    placeholder: 'A single, precise sentence'
  },
  {
    id: 'bio',
    field: 'bio',
    target: 'profile',
    label: 'Overview',
    prompt: 'Give a short overview a counterparty should read first.',
    kind: 'textarea',
    placeholder: 'Two or three sentences'
  },
  {
    id: 'focus_areas',
    field: 'focus_areas',
    target: 'profile',
    label: 'Focus areas',
    prompt: 'What are your core focus areas?',
    kind: 'tags',
    placeholder: 'Add a few and press enter'
  },
  {
    id: 'linkedin',
    field: 'linkedin',
    target: 'details',
    label: 'LinkedIn',
    prompt: 'What is your LinkedIn URL? (optional)',
    kind: 'url',
    placeholder: 'https://linkedin.com/in/…',
    optional: true
  },
  {
    id: 'website',
    field: 'website',
    target: 'details',
    label: 'Website',
    prompt: 'What is your website? (optional)',
    kind: 'url',
    placeholder: 'https://…',
    optional: true
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
      ]
    },
    {
      id: 'check_size',
      field: 'check_size',
      target: 'details',
      label: 'Typical check size',
      prompt: 'What check size do you typically write?',
      kind: 'text',
      placeholder: 'e.g. $250K–$2M'
    },
    {
      id: 'sectors',
      field: 'sectors',
      target: 'details',
      label: 'Sectors',
      prompt: 'Which sectors do you invest in?',
      kind: 'tags'
    },
    {
      id: 'stage_focus',
      field: 'stage_focus',
      target: 'details',
      label: 'Stage focus',
      prompt: 'What stages do you focus on?',
      kind: 'tags',
      placeholder: 'Pre-seed, Seed, Series A…'
    },
    {
      id: 'thesis',
      field: 'thesis',
      target: 'details',
      label: 'Investment thesis',
      prompt: 'What is your investment thesis?',
      kind: 'textarea'
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
      ]
    },
    {
      id: 'services_offered',
      field: 'services_offered',
      target: 'details',
      label: 'Services offered',
      prompt: 'Which specific services do you offer?',
      kind: 'tags'
    },
    {
      id: 'ideal_client',
      field: 'ideal_client',
      target: 'details',
      label: 'Ideal client',
      prompt: 'Who is your ideal client?',
      kind: 'textarea'
    },
    {
      id: 'engagement_model',
      field: 'engagement_model',
      target: 'details',
      label: 'Engagement model',
      prompt: 'How do you typically engage?',
      kind: 'select',
      options: ['Retainer', 'Project-based', 'Success fee', 'Hourly', 'Other']
    }
  ],
  startup: [
    {
      id: 'sector',
      field: 'sector',
      target: 'details',
      label: 'Sector',
      prompt: 'What sector is your company in?',
      kind: 'tags'
    },
    {
      id: 'stage',
      field: 'stage',
      target: 'details',
      label: 'Stage',
      prompt: 'What stage are you at?',
      kind: 'select',
      options: ['Idea', 'Pre-seed', 'Seed', 'Series A', 'Series B+', 'Growth']
    },
    {
      id: 'raising',
      field: 'raising',
      target: 'details',
      label: 'Raising',
      prompt: 'Are you raising, and on what terms?',
      kind: 'text',
      placeholder: 'e.g. $1.5M on a SAFE'
    },
    {
      id: 'traction',
      field: 'traction',
      target: 'details',
      label: 'Traction',
      prompt: 'What traction can you point to?',
      kind: 'textarea'
    }
  ],
  student: [
    {
      id: 'institution',
      field: 'institution',
      target: 'details',
      label: 'Institution',
      prompt: 'Where do you study?',
      kind: 'text'
    },
    {
      id: 'field_of_study',
      field: 'field_of_study',
      target: 'details',
      label: 'Field of study',
      prompt: 'What is your field of study?',
      kind: 'text'
    },
    {
      id: 'interest_area',
      field: 'interest_area',
      target: 'details',
      label: 'Interests',
      prompt: 'Which areas of private markets interest you most?',
      kind: 'tags'
    },
    {
      id: 'career_goal',
      field: 'career_goal',
      target: 'details',
      label: 'Career goal',
      prompt: 'What are you working toward?',
      kind: 'textarea'
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
      options: ['Angel', 'Limited partner', 'Syndicate lead', 'Operator-investor', 'Other']
    },
    {
      id: 'check_size',
      field: 'check_size',
      target: 'details',
      label: 'Typical check size',
      prompt: 'What check size do you typically write?',
      kind: 'text',
      placeholder: 'e.g. $25K–$100K'
    },
    {
      id: 'sectors',
      field: 'sectors',
      target: 'details',
      label: 'Sectors',
      prompt: 'Which sectors interest you?',
      kind: 'tags'
    },
    {
      id: 'value_add',
      field: 'value_add',
      target: 'details',
      label: 'Value-add',
      prompt: 'Beyond capital, what do you bring?',
      kind: 'textarea'
    }
  ]
};

/** The full ordered question set for a member type (common, then specific). */
export function getQuestionSet(memberType: MemberType): ProfileQuestion[] {
  return [...COMMON, ...SPECIFIC[memberType]];
}

/** Look up one question by id within a member type's set. */
export function getQuestion(memberType: MemberType, id: string): ProfileQuestion | null {
  return getQuestionSet(memberType).find((q) => q.id === id) ?? null;
}
