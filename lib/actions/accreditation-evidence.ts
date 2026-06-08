'use server';

import { createAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';

/* ============================================================================
 * lib/actions/accreditation-evidence.ts — accreditation document upload +
 * owner-side signed download for 506(c) raise reservations.
 *
 * Upload flow (investor, unauthenticated):
 *   1. createAccreditationUploadUrl — validates token + file metadata, then
 *      calls service-role createSignedUploadUrl so the browser can PUT the
 *      file directly without an authenticated session.
 *   2. Browser PUTs the file to the returned signedUrl.
 *   3. submitRaiseReservation receives the path and persists it on the row.
 *
 * Download flow (org owner/admin, authenticated):
 *   getAccreditationEvidenceUrl — uses the authed RLS client to assert the
 *   caller owns the raise_interests row, then uses service-role to mint a
 *   short-lived signed download URL. This two-step approach (RLS check first,
 *   service-role URL second) is the security boundary: RLS ensures only the
 *   org owner/admin authorised to see that row can obtain the URL.
 * ========================================================================= */

const ALLOWED_CONTENT_TYPES = [
  'application/pdf',
  'image/png',
  'image/jpeg',
  'image/webp'
] as const;
type AllowedContentType = (typeof ALLOWED_CONTENT_TYPES)[number];

const MAX_SIZE_BYTES = 15 * 1024 * 1024; // 15 MB
const FILENAME_MAX = 120;

/** Strip path separators and other unsafe characters; keep a safe basename. */
function sanitizeFilename(raw: string): string {
  return raw
    .replace(/[/\\]/g, '_')
    .replace(/[^a-zA-Z0-9._\-() ]/g, '_')
    .trim()
    .slice(0, FILENAME_MAX)
    || 'document';
}

export type AccreditationUploadUrlResult =
  | { ok: true; path: string; signedUrl: string }
  | { ok: false; error: string };

/**
 * Generate a service-role signed upload URL for an accreditation document.
 * The caller (browser, unauthenticated investor) will PUT the file directly
 * to the returned URL. The returned `path` should be passed to
 * `submitRaiseReservation` as `verificationDocumentPath`.
 */
export async function createAccreditationUploadUrl(input: {
  token: string;
  filename: string;
  contentType: string;
  sizeBytes: number;
}): Promise<AccreditationUploadUrlResult> {
  const token = typeof input.token === 'string' ? input.token.trim().slice(0, 200) : '';
  if (!token || token.length < 16) {
    return { ok: false, error: 'This raise link is invalid.' };
  }

  // Validate content type against allowlist.
  if (!(ALLOWED_CONTENT_TYPES as readonly string[]).includes(input.contentType)) {
    return {
      ok: false,
      error: 'Only PDF and image files (PNG, JPEG, WebP) are accepted.'
    };
  }

  // Validate size.
  if (
    typeof input.sizeBytes !== 'number' ||
    !Number.isFinite(input.sizeBytes) ||
    input.sizeBytes <= 0 ||
    input.sizeBytes > MAX_SIZE_BYTES
  ) {
    return { ok: false, error: 'File must be between 1 byte and 15 MB.' };
  }

  const safeFilename = sanitizeFilename(
    typeof input.filename === 'string' ? input.filename : 'document'
  );

  const admin = createAdminClient();

  // Validate the token resolves to a LIVE 506(c) raise page with reservations
  // enabled — same checks as submitRaiseReservation (defense-in-depth).
  const { data: page } = await admin
    .from('raise_pages')
    .select('id, org_id, exemption, accept_reservations, revoked_at, expires_at')
    .eq('token', token)
    .maybeSingle();

  if (!page || page.revoked_at) {
    return { ok: false, error: 'This raise link is no longer active.' };
  }
  if (page.expires_at && new Date(page.expires_at).getTime() <= Date.now()) {
    return { ok: false, error: 'This raise link has expired.' };
  }
  if (page.exemption !== '506c') {
    return { ok: false, error: 'Document upload is only available on 506(c) raises.' };
  }
  if (!page.accept_reservations) {
    return { ok: false, error: 'This raise is not accepting reservations.' };
  }

  // Build the storage path: {org_id}/{uuid}/{safeFilename}
  const { randomUUID } = await import('crypto');
  const path = `${page.org_id}/${randomUUID()}/${safeFilename}`;

  const { data, error } = await admin.storage
    .from('accreditation-evidence')
    .createSignedUploadUrl(path);

  if (error || !data) {
    return { ok: false, error: 'Could not prepare the upload. Please try again.' };
  }

  return { ok: true, path: data.path, signedUrl: data.signedUrl };
}

export type AccreditationEvidenceUrlResult =
  | { ok: true; url: string }
  | { ok: false; error: string };

/**
 * Return a short-lived signed download URL for a reservation's accreditation
 * document. Security boundary:
 *   1. Authed RLS client reads the raise_interests row — only the org owner/
 *      admin (via the existing "owners read raise interests" policy) can see it.
 *   2. Service-role client creates the signed URL — no storage.objects policy
 *      is evaluated here; the RLS step above is the authorisation gate.
 */
export async function getAccreditationEvidenceUrl(
  interestId: string
): Promise<AccreditationEvidenceUrlResult> {
  if (!interestId) return { ok: false, error: 'Missing reservation.' };

  // Step 1: authed RLS check — asserts the caller is the org owner/admin.
  const supabase = await createClient();
  const { data: row } = await supabase
    .from('raise_interests')
    .select('*')
    .eq('id', interestId)
    .maybeSingle();

  if (!row) return { ok: false, error: 'Not found.' };

  const path: string | null = row.verification_document_path ?? null;

  if (!path) return { ok: false, error: 'No document on file.' };

  // Step 2: service-role signs the URL (60 s TTL — enough to open a tab).
  const admin = createAdminClient();
  const { data: urlData, error } = await admin.storage
    .from('accreditation-evidence')
    .createSignedUrl(path, 60);

  if (error || !urlData?.signedUrl) {
    return { ok: false, error: 'Could not generate a download link. Please try again.' };
  }

  return { ok: true, url: urlData.signedUrl };
}
