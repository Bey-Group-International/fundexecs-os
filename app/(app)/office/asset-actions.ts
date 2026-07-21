"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { createServerClient, hasSupabaseServerEnv } from "@/lib/supabase/server";
import { getSessionContext } from "@/lib/auth";

// Custom image props (uploaded branding — logos, posters, wall art) for the
// Virtual Office MapMaker. Uploaded PNGs are cached in a PUBLIC-read Storage
// bucket at `${orgId}/${uuid}.png` (added 20260721000000) and placed on the
// floor as `kind:"image"` objects that reference the public URL via `src`.
//
// Mirrors portrait-actions.ts: re-checks auth server-side, never trusts the
// client's orgId (operates against the session's own org), and never throws —
// upload returns `{ url: null, error }` and list returns `[]` on any failure.

const BUCKET = "office-assets";

// Storage isn't in the generated DB types yet, so it's reached through a narrow
// unknown-cast until the types are regenerated (as in portrait-actions.ts).
type LoosePromise<T> = Promise<{ data: T; error: { message: string } | null }>;
interface LooseBucket {
  upload: (
    path: string,
    body: Uint8Array,
    opts: { upsert: boolean; contentType: string },
  ) => LoosePromise<unknown>;
  getPublicUrl: (path: string) => { data: { publicUrl: string } };
  list: (
    prefix: string,
    opts?: { limit?: number; sortBy?: { column: string; order: string } },
  ) => LoosePromise<{ name: string }[] | null>;
}
type LooseClient = {
  storage: { from: (bucket: string) => LooseBucket };
};

/** Decode a `data:` URL into raw bytes, or null if it isn't a valid data URL. */
function decodeDataUrl(dataUrl: string): Uint8Array | null {
  const comma = dataUrl.indexOf(",");
  if (!dataUrl.startsWith("data:") || comma === -1) return null;
  const meta = dataUrl.slice(5, comma);
  const body = dataUrl.slice(comma + 1);
  try {
    if (meta.includes(";base64")) {
      return new Uint8Array(Buffer.from(body, "base64"));
    }
    return new Uint8Array(Buffer.from(decodeURIComponent(body), "utf-8"));
  } catch {
    return null;
  }
}

/**
 * Upload a branding image (as a data URL) to the org's `office-assets` bucket
 * and return its cache-busted public URL. Re-checks auth, ignores the client's
 * orgId in favor of the session's own org, and never throws — returns
 * `{ url: null, error }` on any failure. `name` is accepted for a friendlier
 * caption but the stored object is always a fresh `${orgId}/${uuid}.png`.
 */
export async function uploadOfficeImage(
  orgId: string,
  dataUrl: string,
  name?: string,
): Promise<{ url: string | null; error?: string }> {
  void name;
  const ctx = await getSessionContext();
  if (!ctx?.orgId || !ctx.userId) {
    return { url: null, error: "Not authenticated" };
  }
  // Never trust the client's orgId — operate against the session's own org.
  if (orgId && orgId !== ctx.orgId) {
    return { url: null, error: "Organization mismatch" };
  }
  if (!hasSupabaseServerEnv()) {
    return { url: null, error: "Supabase not configured" };
  }

  const bytes = decodeDataUrl(dataUrl);
  if (!bytes || bytes.length === 0) {
    return { url: null, error: "Invalid image data" };
  }

  try {
    const supabase = (await createServerClient()) as unknown as LooseClient;
    const path = `${ctx.orgId}/${randomUUID()}.png`;
    const bucket = supabase.storage.from(BUCKET);
    const { error: uploadError } = await bucket.upload(path, bytes, {
      upsert: false,
      contentType: "image/png",
    });
    if (uploadError) return { url: null, error: uploadError.message };

    const { data: publicData } = bucket.getPublicUrl(path);
    const url = `${publicData.publicUrl}?v=${Date.now()}`;

    revalidatePath("/office");
    return { url };
  } catch (err) {
    return {
      url: null,
      error: err instanceof Error ? err.message : "Upload failed",
    };
  }
}

/**
 * List the public URLs of the org's uploaded office images (best-effort).
 * Ignores the client's orgId in favor of the session's own org; returns `[]`
 * when unauthenticated, unconfigured, or on any error.
 */
export async function listOfficeImages(orgId: string): Promise<string[]> {
  const ctx = await getSessionContext();
  if (!ctx?.orgId || !ctx.userId) return [];
  if (orgId && orgId !== ctx.orgId) return [];
  if (!hasSupabaseServerEnv()) return [];

  try {
    const supabase = (await createServerClient()) as unknown as LooseClient;
    const bucket = supabase.storage.from(BUCKET);
    const { data, error } = await bucket.list(ctx.orgId, {
      limit: 100,
      sortBy: { column: "created_at", order: "desc" },
    });
    if (error || !data) return [];
    return data
      .filter((o) => typeof o.name === "string" && !o.name.startsWith("."))
      .map((o) => bucket.getPublicUrl(`${ctx.orgId}/${o.name}`).data.publicUrl);
  } catch {
    return [];
  }
}
