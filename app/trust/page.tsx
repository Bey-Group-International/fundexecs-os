import { redirect } from 'next/navigation';

/**
 * The Chain-of-Trust / Trust Center surface lives on the Command Center: the
 * four-layer proof strip and the Trust drawer (proof layers, evidence,
 * approvals) are mounted in the dashboard hero. Route the rail's "Trust Center"
 * entry there so it opens the real surface instead of a placeholder.
 */
export default function TrustPage() {
  redirect('/command-center');
}
