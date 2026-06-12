import { redirect } from 'next/navigation';

/**
 * /run resolves to the hub's first tab — the prototype opens RunHub on
 * Diligence. The hub chrome lives in ./layout.tsx.
 */
export default function RunHubPage() {
  redirect('/run/diligence');
}
