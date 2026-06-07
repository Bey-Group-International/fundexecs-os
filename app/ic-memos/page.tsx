import { redirect } from 'next/navigation';

/**
 * IC Memos are the diligence Synthesis already shipped under `/diligence`
 * (the 7-agent committee + memo library). The rail's "IC Memos" entry routes
 * here so it lands on the real surface instead of a placeholder.
 */
export default function IcMemosPage() {
  redirect('/diligence');
}
