import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

export const metadata: Metadata = {
  title: { absolute: 'FundExecs OS — Governance' },
  description: 'Your 100·30·10 governance plan and objective framework — strategy on the record.'
};

/**
 * The Governance Plan / 100·30·10 objective framework is the existing Strategy
 * surface (`governance_plans` / `objectives`). Route the rail's "Governance"
 * entry to `/strategy` so it lands on the real plan instead of a placeholder.
 */
export default function GovernancePage() {
  redirect('/strategy');
}
