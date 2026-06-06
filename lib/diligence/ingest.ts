import 'server-only';
import { createAdminClient } from '@/lib/supabase/admin';
import type { Json } from '@/lib/supabase/database.types';
import { embedTexts } from '@/lib/ai/voyage';
import { chunkText, extractTextFromDiligenceFile, type TextChunk } from './extract';

const DILIGENCE_BUCKET = 'diligence';
const EMBED_BATCH_SIZE = 32;

const DOCUMENT_KINDS = new Set(['deck', 'cim', 'ppm', 'ddq', 'financials', 'notes', 'other']);

export type DiligenceDocumentKind =
  | 'deck'
  | 'cim'
  | 'ppm'
  | 'ddq'
  | 'financials'
  | 'notes'
  | 'other';

export interface CreateDiligenceDocumentUploadInput {
  orgId: string;
  runId: string;
  fileName: string;
  mimeType: string;
  kind?: DiligenceDocumentKind;
}

export interface CreateDiligenceDocumentUploadResult {
  documentId: string;
  signedUrl: string;
  token: string;
  objectName: string;
  storagePath: string;
  fileName: string;
}

export interface IngestDiligenceDocumentResult {
  documentId: string;
  runId: string;
  orgId: string;
  fileName: string;
  chunkCount: number;
}

export interface IngestDiligenceRunResult {
  runId: string;
  documentCount: number;
  chunkCount: number;
  documents: IngestDiligenceDocumentResult[];
}

type DiligenceDocumentRow = {
  id: string;
  run_id: string;
  org_id: string;
  storage_path: string;
  file_name: string;
  mime_type: string;
  kind: string;
};

export async function createDiligenceDocumentUpload(
  input: CreateDiligenceDocumentUploadInput
): Promise<CreateDiligenceDocumentUploadResult> {
  if (!input.orgId || !input.runId || !input.fileName?.trim()) {
    throw new Error('Missing orgId, runId, or fileName.');
  }
  const kind = input.kind ?? 'other';
  if (!DOCUMENT_KINDS.has(kind)) throw new Error(`Unsupported diligence document kind: ${kind}`);

  const admin = createAdminClient();
  const { data: run, error: runError } = await admin
    .from('diligence_runs')
    .select('id, org_id')
    .eq('id', input.runId)
    .eq('org_id', input.orgId)
    .maybeSingle();
  if (runError) throw new Error(runError.message);
  if (!run) throw new Error('Diligence run not found for org.');

  const safeFileName = sanitizeFileName(input.fileName);
  const objectName = `${input.orgId}/${input.runId}/${safeFileName}`;
  const storagePath = `${DILIGENCE_BUCKET}/${objectName}`;

  const { data: document, error: insertError } = await admin
    .from('diligence_documents')
    .insert({
      org_id: input.orgId,
      run_id: input.runId,
      storage_path: storagePath,
      file_name: safeFileName,
      mime_type: input.mimeType,
      kind
    })
    .select('id')
    .single();
  if (insertError || !document) {
    throw new Error(insertError?.message ?? 'Could not create diligence document row.');
  }

  const { data: signed, error: signError } = await admin.storage
    .from(DILIGENCE_BUCKET)
    .createSignedUploadUrl(objectName);
  if (signError || !signed) {
    await admin.from('diligence_documents').delete().eq('id', document.id);
    throw new Error(signError?.message ?? 'Could not create diligence signed upload URL.');
  }

  return {
    documentId: document.id,
    signedUrl: signed.signedUrl,
    token: signed.token,
    objectName,
    storagePath,
    fileName: safeFileName
  };
}

export async function ingestDiligenceDocument(
  documentId: string
): Promise<IngestDiligenceDocumentResult> {
  if (!documentId) throw new Error('Missing diligence document id.');

  const admin = createAdminClient();
  const document = await loadDiligenceDocument(documentId);
  const objectName = objectNameFromStoragePath(document.storage_path);

  const { data: file, error: downloadError } = await admin.storage
    .from(DILIGENCE_BUCKET)
    .download(objectName);
  if (downloadError || !file) {
    throw new Error(downloadError?.message ?? 'Could not download diligence document.');
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const text = extractTextFromDiligenceFile({
    buffer,
    fileName: document.file_name,
    mimeType: document.mime_type
  });
  const chunks = chunkText(text);
  if (chunks.length === 0) throw new Error('No extractable text found in diligence document.');

  await clearDocumentChunks(document.id);
  const stored = await embedAndStoreChunks(document.id, chunks);

  return {
    documentId: document.id,
    runId: document.run_id,
    orgId: document.org_id,
    fileName: document.file_name,
    chunkCount: stored
  };
}

export async function ingestDiligenceRun(runId: string): Promise<IngestDiligenceRunResult> {
  if (!runId) throw new Error('Missing diligence run id.');
  const admin = createAdminClient();
  const { data: documents, error } = await admin
    .from('diligence_documents')
    .select('id')
    .eq('run_id', runId)
    .order('created_at', { ascending: true });
  if (error) throw new Error(error.message);

  const results: IngestDiligenceDocumentResult[] = [];
  for (const document of documents ?? []) {
    results.push(await ingestDiligenceDocument(document.id));
  }

  return {
    runId,
    documentCount: results.length,
    chunkCount: results.reduce((sum, result) => sum + result.chunkCount, 0),
    documents: results
  };
}

async function loadDiligenceDocument(documentId: string): Promise<DiligenceDocumentRow> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from('diligence_documents')
    .select('id, run_id, org_id, storage_path, file_name, mime_type, kind')
    .eq('id', documentId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error('Diligence document not found.');
  return data;
}

async function clearDocumentChunks(documentId: string): Promise<void> {
  const admin = createAdminClient();
  const { error } = await admin.from('diligence_chunks').delete().eq('document_id', documentId);
  if (error) throw new Error(error.message);
}

async function embedAndStoreChunks(documentId: string, chunks: TextChunk[]): Promise<number> {
  const admin = createAdminClient();
  let stored = 0;

  for (let start = 0; start < chunks.length; start += EMBED_BATCH_SIZE) {
    const batch = chunks.slice(start, start + EMBED_BATCH_SIZE);
    const embeddings = await embedTexts(
      batch.map((chunk) => chunk.content),
      'document'
    );
    const payload = batch.map((chunk, index) => ({
      content: chunk.content,
      embedding: embeddings[index]
    })) as unknown as Json;

    const { data, error } = await admin.rpc('store_diligence_chunks', {
      _document_id: documentId,
      _chunks: payload
    });
    if (error) throw new Error(error.message);
    stored += data ?? 0;
  }

  return stored;
}

function objectNameFromStoragePath(storagePath: string): string {
  return storagePath.startsWith(`${DILIGENCE_BUCKET}/`)
    ? storagePath.slice(DILIGENCE_BUCKET.length + 1)
    : storagePath;
}

function sanitizeFileName(fileName: string): string {
  const safeName = fileName
    .replace(/[\\/]/g, '_')
    .replace(/\s+/g, '_')
    .replace(/[^a-zA-Z0-9._-]/g, '_')
    .slice(0, 200);
  return safeName || `diligence_${Date.now()}`;
}
