// lib/document-storage.server.ts
// Server-only access to the private `documents` bucket.
//
// Every read of an uploaded library file goes through here, and every read is a
// short-lived signed URL: the bucket is private, so there is no URL anyone can
// guess, share, or keep. The caller is responsible for deciding that the reader
// is allowed the file at all — an org member on the GP side, or a data-room
// token that has already cleared the room manifest, the link's section
// allowlist, and the share's gate. This module only mints and revokes bytes.
import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createServiceClient, hasSupabaseServiceEnv } from "@/lib/supabase/server";
import { DOCUMENT_BUCKET } from "@/lib/document-files";
import type { Database } from "@/lib/supabase/database.types";

type Client = SupabaseClient<Database>;

/**
 * How long a minted link lives. Long enough for a browser to follow the
 * redirect and for a large PDF to start streaming; short enough that a URL
 * copied out of a network log or a referrer is worthless by the time anyone
 * reads it.
 */
export const SIGNED_URL_TTL_SECONDS = 120;

function storage(client?: Client) {
  if (client) return client.storage.from(DOCUMENT_BUCKET);
  if (!hasSupabaseServiceEnv()) return null;
  return createServiceClient().storage.from(DOCUMENT_BUCKET);
}

/**
 * Mint a signed URL for one object. Returns null rather than throwing: a
 * failure here must degrade to "this document cannot be opened", never to a
 * 500 on a page an LP is reading.
 */
export async function signDocumentUrl(
  path: string,
  opts: { download?: string; client?: Client } = {},
): Promise<string | null> {
  const bucket = storage(opts.client);
  if (!bucket) return null;
  try {
    const { data, error } = await bucket.createSignedUrl(path, SIGNED_URL_TTL_SECONDS, {
      // Naming the download makes the browser save "Fund IV LPA.pdf" rather
      // than the uuid the object is actually stored under.
      ...(opts.download ? { download: opts.download } : {}),
    });
    if (error || !data?.signedUrl) return null;
    return data.signedUrl;
  } catch {
    return null;
  }
}

export interface StoredObject {
  size: number;
  mimeType: string | null;
}

/**
 * Read back what Storage actually holds at a path.
 *
 * The browser uploads straight to Storage with a signed ticket, so the size and
 * type it told us beforehand are a claim, not a fact — this is how the claim
 * gets checked before it is written onto the document row. A path with no
 * object behind it returns null, which is also how an abandoned upload is
 * detected.
 */
export async function statDocumentObject(path: string): Promise<StoredObject | null> {
  const bucket = storage();
  if (!bucket) return null;
  const slash = path.lastIndexOf("/");
  if (slash <= 0) return null;
  const dir = path.slice(0, slash);
  const file = path.slice(slash + 1);
  try {
    const { data, error } = await bucket.list(dir, { limit: 100, search: file });
    if (error || !data) return null;
    // `search` is a prefix match, so the exact name still has to be picked out.
    const match = data.find((o) => o.name === file);
    if (!match) return null;
    const meta = (match.metadata ?? {}) as { size?: number; mimetype?: string };
    return {
      size: typeof meta.size === "number" ? meta.size : 0,
      mimeType: typeof meta.mimetype === "string" ? meta.mimetype : null,
    };
  } catch {
    return null;
  }
}

/** Remove specific objects. Missing objects are not an error. */
export async function removeDocumentObjects(paths: string[]): Promise<void> {
  const bucket = storage();
  if (!bucket || paths.length === 0) return;
  try {
    await bucket.remove(paths);
  } catch {
    // Best effort: a document row must still be deletable when Storage is down.
  }
}

/**
 * Remove every object belonging to one document — the current file and every
 * version's file, which all share the `${orgId}/${documentId}/` prefix.
 *
 * This is why the prefix carries the document id. Without it, deleting a
 * document would leave its bytes in the bucket forever, still fetchable by
 * anyone who had once been handed a signed URL's path.
 */
export async function removeDocumentPrefix(orgId: string, documentId: string): Promise<void> {
  const bucket = storage();
  if (!bucket) return;
  const dir = `${orgId}/${documentId}`;
  try {
    const { data, error } = await bucket.list(dir, { limit: 1000 });
    if (error || !data || data.length === 0) return;
    await bucket.remove(data.map((o) => `${dir}/${o.name}`));
  } catch {
    // Best effort, as above.
  }
}
