import { redirect } from 'next/navigation';

/**
 * BUILD — the hub opens on its first tab, the prototype's default. The hub
 * chrome (hero, stats, tabs, Earn note) lives in layout.tsx and wraps every
 * /build/* module.
 */
export default function BuildHubPage() {
  redirect('/build/formation');
}
