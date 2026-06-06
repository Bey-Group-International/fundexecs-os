/**
 * Fund Profile barrel — exports the four sub-components consumed by
 * `app/profile/page.tsx` plus the prop type signatures backend can wire to
 * a real `FundProfile` payload from `lib/queries/fund-profile`.
 */
export { FundProfileHero } from './FundProfileHero';
export type { FundProfileHeroProps } from './FundProfileHero';

export { FundProfileSections } from './FundProfileSections';
export type { FundProfileSectionsProps } from './FundProfileSections';

export { FundProfileGapsCard } from './FundProfileGapsCard';
export type { FundProfileGapsCardProps } from './FundProfileGapsCard';

export {
  FundProfileRailSummary,
  FundProfileRailSummaryEmpty
} from './FundProfileRailSummary';
export type { FundProfileRailSummaryProps } from './FundProfileRailSummary';
