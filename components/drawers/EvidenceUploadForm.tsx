'use client';

import { useRef, useState, useTransition } from 'react';
import { Upload } from 'lucide-react';
import { Button } from '@/components/ui';
import { uploadEvidence, finalizeEvidenceUpload } from '@/lib/actions/trust';

const MAX_BYTES = 25 * 1024 * 1024;

const ALLOWED_MIME = new Set([
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/zip',
  'application/json',
  'text/plain',
  'text/csv',
  'text/markdown',
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif'
]);

export type LayerKey = 'truth' | 'concept' | 'execution' | 'work';

export interface EvidenceUploadFormProps {
  recordId: string;
  layer: LayerKey;
  /** Called after a successful upload + finalize so the parent can
   *  refresh its data. */
  onUploaded: () => void;
}

/**
 * Two-step direct-to-Storage upload:
 *   1. server action mints a signed upload URL for `{org}/{record}/{ev}/{file}`
 *   2. client PUTs the bytes straight to Supabase Storage with that token
 *   3. server action finalizes (touches uploaded_at, kicks off AI validation)
 *
 * Never touches the service-role key. The signed URL is short-lived and
 * scoped to a single object path.
 */
export function EvidenceUploadForm({ recordId, layer, onUploaded }: EvidenceUploadFormProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function pickFile() {
    setError(null);
    inputRef.current?.click();
  }

  function onChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (file.size > MAX_BYTES) {
      setError('File exceeds the 25 MB limit.');
      return;
    }
    if (!ALLOWED_MIME.has(file.type)) {
      setError(`File type ${file.type || 'unknown'} is not supported.`);
      return;
    }
    startTransition(async () => {
      const r = await uploadEvidence({
        recordId,
        layer,
        fileName: file.name,
        mimeType: file.type,
        sizeBytes: file.size
      });
      if (!r.ok) {
        setError(r.error);
        return;
      }
      // Step 2: PUT directly to Supabase Storage using the signed URL.
      try {
        const put = await fetch(r.signedUrl, {
          method: 'PUT',
          headers: { 'Content-Type': file.type },
          body: file
        });
        if (!put.ok) {
          setError(`Upload failed (${put.status}). The evidence row was rolled back.`);
          return;
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Upload failed.');
        return;
      }
      // Step 3: server-side finalize + AI validation kickoff.
      const fin = await finalizeEvidenceUpload(r.evidenceId);
      if (!fin.ok) {
        setError(fin.error);
        return;
      }
      onUploaded();
    });
  }

  return (
    <div className="flex flex-col gap-2">
      <input
        ref={inputRef}
        type="file"
        className="hidden"
        aria-label={`Upload evidence for ${layer}`}
        accept=".pdf,.docx,.xlsx,.pptx,.zip,.json,.txt,.csv,.md,.png,.jpg,.jpeg,.webp,.gif"
        onChange={onChange}
        data-testid={`evidence-file-${layer}`}
      />
      <Button
        variant="secondary"
        size="sm"
        icon={Upload}
        onClick={pickFile}
        disabled={pending}
        data-testid={`evidence-upload-${layer}`}
      >
        {pending ? 'Uploading…' : 'Upload evidence'}
      </Button>
      {error ? (
        <p
          role="alert"
          className="rounded-md border border-[var(--danger-line)] bg-[var(--danger-soft)] px-2.5 py-1.5 text-[11.5px] text-danger"
        >
          {error}
        </p>
      ) : null}
    </div>
  );
}

export default EvidenceUploadForm;
