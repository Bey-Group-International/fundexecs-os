import {
  Workflow,
  Sparkles,
  ScanSearch,
  Briefcase,
  CloudRain,
  Radar,
  Link2,
  Scale,
  Megaphone,
  Search,
  Filter,
  Ticket,
  Users,
  Landmark,
  GraduationCap,
  type LucideIcon
} from 'lucide-react';

export type BrainStatus = 'Active' | 'Review' | 'Draft';

/** The 15 specialized Earn AI brains. Shaped to mirror the `ai_brains` table —
 * each row carries vector-store stats (docs, embedded chunks) for pgvector. */
export interface Brain {
  slug: string;
  name: string;
  role: string;
  icon: LucideIcon;
  docs: number;
  chunks: number;
  status: BrainStatus;
}

export const BRAINS: Brain[] = [
  {
    slug: 'master-workflow',
    name: 'Master Workflow',
    role: 'Routes intake across every brain',
    icon: Workflow,
    docs: 8,
    chunks: 264,
    status: 'Active'
  },
  {
    slug: 'earnest-fundmaker',
    name: 'Earnest Fundmaker',
    role: 'Private-market assistant',
    icon: Sparkles,
    docs: 14,
    chunks: 512,
    status: 'Active'
  },
  {
    slug: 'automater-scrubber',
    name: 'Automater / Scrubber',
    role: 'Cleans and structures inbound data',
    icon: ScanSearch,
    docs: 7,
    chunks: 198,
    status: 'Active'
  },
  {
    slug: 'executive-advisor',
    name: 'Executive Advisor',
    role: 'Strategy and decision support',
    icon: Briefcase,
    docs: 12,
    chunks: 421,
    status: 'Active'
  },
  {
    slug: 'rainmaker',
    name: 'Rainmaker',
    role: 'Demand generation',
    icon: CloudRain,
    docs: 9,
    chunks: 287,
    status: 'Active'
  },
  {
    slug: 'deal-sourcer',
    name: 'Deal Sourcer',
    role: 'Finds and scores opportunities',
    icon: Radar,
    docs: 11,
    chunks: 356,
    status: 'Active'
  },
  {
    slug: 'capital-connector',
    name: 'Capital Connector',
    role: 'Matches capital to deals',
    icon: Link2,
    docs: 9,
    chunks: 301,
    status: 'Active'
  },
  {
    slug: 'legal-admin',
    name: 'Legal / Admin',
    role: 'Compliance and risk review',
    icon: Scale,
    docs: 6,
    chunks: 174,
    status: 'Review'
  },
  {
    slug: 'pr-director',
    name: 'PR Director',
    role: 'Narrative and media',
    icon: Megaphone,
    docs: 8,
    chunks: 233,
    status: 'Active'
  },
  {
    slug: 'seo-disrupter',
    name: 'SEO Disrupter',
    role: 'Organic visibility',
    icon: Search,
    docs: 5,
    chunks: 142,
    status: 'Draft'
  },
  {
    slug: 'lead-generator',
    name: 'Lead Generator',
    role: 'Top-of-funnel sourcing',
    icon: Filter,
    docs: 7,
    chunks: 211,
    status: 'Active'
  },
  {
    slug: 'private-event-curator',
    name: 'Private Event Curator',
    role: 'Curated investor events',
    icon: Ticket,
    docs: 4,
    chunks: 98,
    status: 'Active'
  },
  {
    slug: 'investor-relations',
    name: 'Investor Relations',
    role: 'LP communications',
    icon: Users,
    docs: 6,
    chunks: 187,
    status: 'Active'
  },
  {
    slug: 'elite-capital-raiser',
    name: 'Elite Capital Raiser',
    role: 'Institutional fundraising',
    icon: Landmark,
    docs: 5,
    chunks: 156,
    status: 'Active'
  },
  {
    slug: 'workflow-instructor',
    name: 'Workflow Instructor',
    role: 'Onboarding and education',
    icon: GraduationCap,
    docs: 4,
    chunks: 112,
    status: 'Active'
  }
];
