import 'server-only';
import Anthropic from '@anthropic-ai/sdk';
import { createAdminClient } from '@/lib/supabase/admin';
import type { Database } from '@/lib/supabase/database.types';

const TRUST_BUCKET = 'trust-evidence';
const MODEL = process.env.EARN_MODEL || 'claude-sonnet-4-6';
const FALLBACK_NOTE = 'AI validation unavailable; proceed with manual review.';

type EvidenceRow = Database['public']['Tables']['evidence']['Row'];

const TEXT_MIME_PREFIXES = ['text/', 'application/json'];
const IMAGE_MIME_PREFIXES = ['image/'];
// Hard cap on the snippet we send to Claude — keeps the prompt under
// 1k tokens regardless of file size.
const SNIPPET_MAX_CHARS = 4000;

interface EvidenceContext {
  evidence: EvidenceRow & {
    file_name: string | null;
    mime_type: string | null;
    size_bytes: number | null;
  };
  layerName: string;
  recordEntityType: string;
  recordEntityId: string;
}

async function loadContext(evidenceId: string): Promise<EvidenceContext | null> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from('evidence')
    .select(
      `id, org_id, proof_layer_id, storage_path, file_name, mime_type, size_bytes,
       proof_layer:proof_layers (
         layer_name,
         chain:chain_of_trust_records ( entity_type, entity_id )
       )`
    )
    .eq('id', evidenceId)
    .maybeSingle();
  if (error || !data) return null;
  const row = data as unknown as {
    id: string;
    org_id: string;
    proof_layer_id: string;
    storage_path: string;
    file_name: string | null;
    mime_type: string | null;
    size_bytes: number | null;
    proof_layer: {
      layer_name: string;
      chain: { entity_type: string; entity_id: string };
    };
  };
  return {
    evidence: {
      id: row.id,
      org_id: row.org_id,
      proof_layer_id: row.proof_layer_id,
      storage_path: row.storage_path,
      file_name: row.file_name,
      mime_type: row.mime_type,
      size_bytes: row.size_bytes
    } as EvidenceContext['evidence'],
    layerName: row.proof_layer.layer_name,
    recordEntityType: row.proof_layer.chain.entity_type,
    recordEntityId: row.proof_layer.chain.entity_id
  };
}

async function fetchTextSnippet(storagePath: string): Promise<string | null> {
  const admin = createAdminClient();
  const { data, error } = await admin.storage.from(TRUST_BUCKET).download(storagePath);
  if (error || !data) return null;
  try {
    const text = await data.text();
    return text.slice(0, SNIPPET_MAX_CHARS);
  } catch {
    return null;
  }
}

async function fetchImageBase64(
  storagePath: string,
  mimeType: string
): Promise<{ media_type: string; data: string } | null> {
  const admin = createAdminClient();
  const { data, error } = await admin.storage.from(TRUST_BUCKET).download(storagePath);
  if (error || !data) return null;
  try {
    const buffer = Buffer.from(await data.arrayBuffer());
    return { media_type: mimeType, data: buffer.toString('base64') };
  } catch {
    return null;
  }
}

function buildPrompt(ctx: EvidenceContext, snippet: string | null): string {
  const subjectLabel =
    ctx.recordEntityType === 'deal'
      ? 'a deal in the pipeline'
      : ctx.recordEntityType === 'member_profile'
        ? 'a member profile'
        : ctx.recordEntityType === 'objective'
          ? 'a strategic objective'
          : `a ${ctx.recordEntityType}`;

  const fileLabel = ctx.evidence.file_name ?? 'an uploaded file';
  const sizeLabel = ctx.evidence.size_bytes
    ? `${Math.round(ctx.evidence.size_bytes / 1024)} KB`
    : 'unknown size';
  const mimeLabel = ctx.evidence.mime_type ?? 'unknown type';

  const head = `You are reviewing evidence supplied for the **${ctx.layerName}** layer of a Chain-of-Trust record on ${subjectLabel}.\n\nFile: ${fileLabel} (${mimeLabel}, ${sizeLabel})`;

  if (snippet) {
    return `${head}\n\nText excerpt (truncated to ${SNIPPET_MAX_CHARS} chars):\n"""\n${snippet}\n"""\n\nIn ≤200 words: assess this evidence for the ${ctx.layerName} layer. Note strengths, gaps, and anything an approver should double-check before signing off. Sentence case, calm and operator-grade.`;
  }
  return `${head}\n\nThe file was uploaded but no text excerpt is available (binary or unsupported format).\n\nIn ≤200 words: based on the filename, mime type, and the layer it supports, suggest what an approver should verify before signing off. Sentence case, calm and operator-grade.`;
}

export async function aiValidateEvidence(evidenceId: string): Promise<void> {
  const admin = createAdminClient();
  const ctx = await loadContext(evidenceId);
  if (!ctx) return;

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    await admin
      .from('evidence')
      .update({
        ai_validation_notes: FALLBACK_NOTE,
        ai_validated_at: new Date().toISOString()
      })
      .eq('id', evidenceId);
    return;
  }

  let notes = FALLBACK_NOTE;
  try {
    const isText = TEXT_MIME_PREFIXES.some((p) => (ctx.evidence.mime_type ?? '').startsWith(p));
    const isImage = IMAGE_MIME_PREFIXES.some((p) => (ctx.evidence.mime_type ?? '').startsWith(p));

    let textSnippet: string | null = null;
    let imageInput: { media_type: string; data: string } | null = null;
    if (isText) {
      textSnippet = await fetchTextSnippet(ctx.evidence.storage_path);
    } else if (isImage) {
      imageInput = await fetchImageBase64(
        ctx.evidence.storage_path,
        ctx.evidence.mime_type ?? 'image/png'
      );
    }

    const client = new Anthropic({ apiKey });
    const prompt = buildPrompt(ctx, textSnippet);

    type ContentBlock =
      | { type: 'text'; text: string }
      | {
          type: 'image';
          source: { type: 'base64'; media_type: string; data: string };
        };
    const userContent: ContentBlock[] = [{ type: 'text', text: prompt }];
    if (imageInput) {
      userContent.unshift({
        type: 'image',
        source: {
          type: 'base64',
          media_type: imageInput.media_type,
          data: imageInput.data
        }
      });
    }

    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 600,
      system:
        'You are Earn, the COO of a 15-specialist AI executive team inside FundExecs OS. You are validating an evidence artefact for a Chain-of-Trust layer. Be concise, declarative, operator-grade. ≤200 words.',
      messages: [{ role: 'user', content: userContent }]
    });

    const text = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('\n')
      .trim();
    if (text) notes = text;
  } catch {
    // best-effort; FALLBACK_NOTE remains
  }

  await admin
    .from('evidence')
    .update({
      ai_validation_notes: notes,
      ai_validated_at: new Date().toISOString()
    })
    .eq('id', evidenceId);
}
