import { redirect } from 'next/navigation';

/**
 * The Knowledge Base is the 15-specialist RAG surfaced through Ask Earn
 * (`/ask-earn`) — query the team over your own documents and history. Route the
 * rail's "Knowledge Base" entry to that real surface instead of a placeholder.
 */
export default function KnowledgePage() {
  redirect('/ask-earn');
}
