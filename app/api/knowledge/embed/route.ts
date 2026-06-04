import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { embedTexts, toVectorLiteral } from '@/lib/ai/voyage';
import { BRAINS } from '@/lib/ai/brains';

/**
 * POST /api/knowledge/embed — one-time (idempotent) ingestion that embeds the
 * 15 global brain seeds into knowledge_chunks via Voyage so Earn's RAG has
 * grounding. Admin-only. Run once after VOYAGE_API_KEY is configured.
 */
export async function POST() {
  const supabase = await createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  const admin = createAdminClient();

  // Gate to org owners/admins.
  const { data: adminRows } = await admin
    .from('org_members')
    .select('id')
    .eq('user_id', user.id)
    .in('role', ['owner', 'admin'])
    .limit(1);
  if (!adminRows || adminRows.length === 0) {
    return NextResponse.json({ error: 'Admin only' }, { status: 403 });
  }
  if (!process.env.VOYAGE_API_KEY) {
    return NextResponse.json({ error: 'Set VOYAGE_API_KEY first.' }, { status: 503 });
  }

  // Map brain slugs -> global ai_brain ids.
  const { data: brains } = await admin.from('ai_brains').select('id, slug').is('org_id', null);
  const bySlug = new Map((brains ?? []).map((b) => [b.slug, b.id]));
  const toEmbed = BRAINS.filter((b) => bySlug.has(b.slug));

  if (toEmbed.length === 0) {
    return NextResponse.json({ ok: true, embedded: 0, note: 'No matching global brains found.' });
  }

  const vectors = await embedTexts(
    toEmbed.map((b) => `${b.title}\n\n${b.content}`),
    'document'
  );

  let embedded = 0;
  for (let i = 0; i < toEmbed.length; i++) {
    const brain = toEmbed[i];
    const brainId = bySlug.get(brain.slug)!;

    let docId: string | undefined;
    const { data: existingDoc } = await admin
      .from('knowledge_documents')
      .select('id')
      .eq('brain_id', brainId)
      .eq('title', brain.title)
      .maybeSingle();
    docId = existingDoc?.id;
    if (!docId) {
      const { data: doc } = await admin
        .from('knowledge_documents')
        .insert({
          brain_id: brainId,
          org_id: null,
          title: brain.title,
          source: 'seed',
          content: brain.content
        })
        .select('id')
        .single();
      docId = doc?.id;
    }
    if (!docId) continue;

    const { data: existingChunk } = await admin
      .from('knowledge_chunks')
      .select('id')
      .eq('document_id', docId)
      .limit(1);
    if (existingChunk && existingChunk.length > 0) continue;

    const { error } = await admin.from('knowledge_chunks').insert({
      brain_id: brainId,
      org_id: null,
      document_id: docId,
      chunk_index: 0,
      content: `${brain.title}\n\n${brain.content}`,
      embedding: toVectorLiteral(vectors[i])
    });
    if (!error) embedded++;
  }

  return NextResponse.json({ ok: true, embedded });
}
