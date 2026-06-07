import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

export const metadata: Metadata = {
  title: { absolute: 'FundExecs OS — Knowledge Base' },
  description: 'Query the 15-specialist team over your own documents and history through Ask Earn.'
};

/**
 * The Knowledge Base is the 15-specialist RAG surfaced through Ask Earn
 * (`/ask-earn`) — query the team over your own documents and history. Route the
 * rail's "Knowledge Base" entry to that real surface instead of a placeholder.
 */
export default function KnowledgePage() {
  redirect('/ask-earn');
}
