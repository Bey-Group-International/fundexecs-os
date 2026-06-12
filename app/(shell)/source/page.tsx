import { redirect } from 'next/navigation';

/**
 * /source resolves to the hub's first tab — the prototype opens SourceHub on
 * the LP Capital Map. The hub chrome lives in ./layout.tsx.
 */
export default function SourceHubPage() {
  redirect('/source/capital-map');
}
