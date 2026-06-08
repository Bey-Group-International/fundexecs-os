import 'server-only';
import Anthropic from '@anthropic-ai/sdk';
import { createAdminClient } from '@/lib/supabase/admin';
import type { Database } from '@/lib/supabase/database.types';
import { AI_MODELS } from './models';

const TRUST_BUCKET = 'trust-evidence';
const MODEL = AI_MODELS.chat;
const FALLBACK_NOTE = 'AI validation unavailable; proceed with manual review.';
/** Hard ceiling on the Claude call so the parent server-action never
 * exceeds ~8s. AbortSignal.timeout is honoured by the @anthropic-ai/sdk
 * client and throws an AbortError that the outer try/catch translates
 * into the never-block fallback. */
const AI_TIMEOUT_MS = 8_000;

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
  // PostgREST nested-join: `proof_layer` and `proof_layer.chain` come
  // back flattened in the runtime payload but supabase-js infers them
  // as arrays. Cast to the resolved object shape to keep call sites
  // ergonomic; column list matches the .select() string.
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

async function writeNotes(
  admin: ReturnType<typeof createAdminClient>,
  evidenceId: string,
  notes: string
): Promise<void> {
  await admin
    .from('evidence')
    .update({
      ai_validation_notes: notes,
      ai_validated_at: new Date().toISOString()
    })
    .eq('id', evidenceId);
}

/**
 * Run AI validation for an uploaded evidence row. **Never-block**:
 * every exit path — missing key, missing context, Claude error, Claude
 * abort/timeout — writes a fallback note + `ai_validated_at` to the
 * evidence row before returning, so the UI always renders something.
 *
 * Designed to be `await`ed inline from the parent server action; the
 * 8-second AbortSignal timeout on the Claude call caps the worst-case
 * latency for the uploader.
 */
export async function aiValidateEvidence(evidenceId: string): Promise<void> {
  const admin = createAdminClient();

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    await writeNotes(admin, evidenceId, FALLBACK_NOTE);
    return;
  }

  // Load context. ANY failure → fallback note (not silent return).
  let ctx: EvidenceContext | null = null;
  try {
    ctx = await loadContext(evidenceId);
  } catch {
    // fall through
  }
  if (!ctx) {
    await writeNotes(admin, evidenceId, FALLBACK_NOTE);
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

    type AnthropicMediaType = 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp';
    type ContentBlock =
      | { type: 'text'; text: string }
      | {
          type: 'image';
          source: { type: 'base64'; media_type: AnthropicMediaType; data: string };
        };
    const userContent: ContentBlock[] = [{ type: 'text', text: prompt }];
    if (imageInput) {
      // Coerce to the narrow allow-list Anthropic accepts; non-matching
      // mime types fall back to png so the request still validates.
      const allowed: AnthropicMediaType[] = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];
      const mt: AnthropicMediaType =
        (allowed.find((a) => a === imageInput.media_type) as AnthropicMediaType | undefined) ??
        'image/png';
      userContent.unshift({
        type: 'image',
        source: {
          type: 'base64',
          media_type: mt,
          data: imageInput.data
        }
      });
    }

    const response = await client.messages.create(
      {
        model: MODEL,
        max_tokens: 600,
        system:
          'You are Earn, the COO of a 15-specialist AI executive team inside FundExecs OS. You are validating an evidence artefact for a Chain-of-Trust layer. Be concise, declarative, operator-grade. ≤200 words.',
        messages: [{ role: 'user', content: userContent }]
      },
      { signal: AbortSignal.timeout(AI_TIMEOUT_MS) }
    );

    const text = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('\n')
      .trim();
    if (text) notes = text;
  } catch {
    // best-effort; FALLBACK_NOTE remains. Covers Claude API errors,
    // network failures, AbortError on the 8s timeout, and JSON parse
    // failures inside the SDK.
  }

  await writeNotes(admin, evidenceId, notes);
}
