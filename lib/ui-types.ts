/**
 * lib/ui-types — shared design-system contracts that backend modules reference
 * without pulling in the React component layer. Kept here so config/query code
 * stays decoupled from `components/`.
 */

/** Badge color tone. Mirror of the `<Badge>` component's accepted tones. */
export type BadgeTone = 'neutral' | 'gold' | 'azure' | 'success' | 'warning' | 'danger' | 'info';
