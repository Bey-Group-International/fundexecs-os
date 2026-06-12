import { redirect } from 'next/navigation';

/**
 * /execute resolves to the hub's first tab — the prototype opens ExecuteHub
 * on Closings. The hub chrome lives in ./layout.tsx.
 */
export default function ExecuteHubPage() {
  redirect('/execute/closings');
}
