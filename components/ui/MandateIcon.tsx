import { createElement } from 'react';
import {
  ArrowLeftRight,
  Banknote,
  Briefcase,
  Building2,
  Calculator,
  CircleUser,
  Compass,
  Database,
  Filter,
  GraduationCap,
  Handshake,
  Infinity as InfinityIcon,
  Landmark,
  Layers,
  ListChecks,
  Megaphone,
  PenLine,
  PieChart,
  Radar,
  Rocket,
  Scale,
  Search,
  ShieldCheck,
  Sprout,
  TrendingUp,
  Users,
  type LucideIcon,
  type LucideProps
} from 'lucide-react';

/**
 * Resolves the string icon names stored in `lib/onboarding/mandate.ts`
 * (kept pure / React-free there) to lucide-react components. Every icon
 * referenced by ROLE_GROUPS, MANDATE_BY_GROUP, TEAM, and workspaceStats
 * must appear here; unknown names fall back to a neutral user glyph.
 */
const ICONS: Record<string, LucideIcon> = {
  'arrow-left-right': ArrowLeftRight,
  banknote: Banknote,
  briefcase: Briefcase,
  'building-2': Building2,
  calculator: Calculator,
  compass: Compass,
  database: Database,
  filter: Filter,
  'graduation-cap': GraduationCap,
  handshake: Handshake,
  infinity: InfinityIcon,
  landmark: Landmark,
  layers: Layers,
  'list-checks': ListChecks,
  megaphone: Megaphone,
  'pen-line': PenLine,
  'pie-chart': PieChart,
  radar: Radar,
  rocket: Rocket,
  scale: Scale,
  search: Search,
  'shield-check': ShieldCheck,
  sprout: Sprout,
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
