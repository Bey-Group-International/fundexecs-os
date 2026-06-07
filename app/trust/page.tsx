import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

export const metadata: Metadata = {
  title: { absolute: 'FundExecs OS — Trust Center' },
  description: 'The Chain-of-Trust — proof layers, evidence, and approvals across your fund.'
};

/**
 * The Chain-of-Trust / Trust Center surface lives on the Command Center: the
 * four-layer proof strip and the Trust drawer (proof layers, evidence,
 * approvals) are mounted in the dashboard hero. Route the rail's "Trust Center"
 * entry there so it opens the real surface instead of a placeholder.
 */
export default function TrustPage() {
  redirect('/command-center');
}
