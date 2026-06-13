import { createElement } from 'react';
import {
  Activity,
  ArrowLeftRight,
  Banknote,
  Blocks,
  BrainCircuit,
  Briefcase,
  Building2,
  Calculator,
  CircleCheckBig,
  CircleUser,
  Compass,
  Cpu,
  Database,
  FileSignature,
  FileText,
  Filter,
  FolderLock,
  GitBranch,
  Globe,
  GraduationCap,
  Handshake,
  IdCard,
  Inbox,
  Infinity as InfinityIcon,
  Landmark,
  Layers,
  ListChecks,
  Megaphone,
  PenLine,
  PieChart,
  Radar,
  Receipt,
  Rocket,
  Scale,
  Search,
  ShieldCheck,
  Sprout,
  Target,
  TrendingUp,
  Users,
  type LucideIcon,
  type LucideProps
} from 'lucide-react';

/**
 * Resolves the string icon names stored in `lib/onboarding/mandate.ts` and
 * `lib/hubs/lifecycle.ts` (kept pure / React-free there) to lucide-react
 * components. Every icon referenced by ROLE_GROUPS, MANDATE_BY_GROUP, TEAM,
 * workspaceStats, HUB_META, and the hub module lists must appear here;
 * unknown names fall back to a neutral user glyph.
 */
const ICONS: Record<string, LucideIcon> = {
  activity: Activity,
  'arrow-left-right': ArrowLeftRight,
  banknote: Banknote,
  blocks: Blocks,
  'brain-circuit': BrainCircuit,
  briefcase: Briefcase,
  'building-2': Building2,
  calculator: Calculator,
  'circle-check-big': CircleCheckBig,
  compass: Compass,
  cpu: Cpu,
  database: Database,
  'file-signature': FileSignature,
  'file-text': FileText,
  filter: Filter,
  'folder-lock': FolderLock,
  'git-branch': GitBranch,
  globe: Globe,
  'graduation-cap': GraduationCap,
  handshake: Handshake,
  'id-card': IdCard,
  inbox: Inbox,
  infinity: InfinityIcon,
  landmark: Landmark,
  layers: Layers,
  'list-checks': ListChecks,
  megaphone: Megaphone,
  'pen-line': PenLine,
  'pie-chart': PieChart,
  radar: Radar,
  receipt: Receipt,
  rocket: Rocket,
  scale: Scale,
  search: Search,
  'shield-check': ShieldCheck,
  sprout: Sprout,
  target: Target,
  'trending-up': TrendingUp,
  users: Users
};

/**
 * Renders a mandate-config icon by name via `createElement` of a statically
 * defined component — keeps render sites clear of "component created during
 * render" while the icon set stays a data-driven lookup.
 */
export function MandateIcon({ name, ...props }: { name: string } & LucideProps) {
  return createElement(ICONS[name] ?? CircleUser, props);
}
