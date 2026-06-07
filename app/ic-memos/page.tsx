import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

export const metadata: Metadata = {
  title: { absolute: 'FundExecs OS — IC Memos' },
  description: 'Investment-committee memos from the diligence synthesis — the 7-agent committee.'
};

/**
 * IC Memos are the diligence Synthesis already shipped under `/diligence`
 * (the 7-agent committee + memo library). The rail's "IC Memos" entry routes
 * here so it lands on the real surface instead of a placeholder.
 */
export default function IcMemosPage() {
  redirect('/diligence');
}
