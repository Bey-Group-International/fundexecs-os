import { NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";
import { getSessionContext } from "@/lib/auth";
import { downloadFileName, isExternalLink, isUploadedFile } from "@/lib/document-files";
import { signDocumentUrl } from "@/lib/document-storage.server";
import type { Document, DocumentVersion } from "@/lib/supabase/database.types";

export const dynamic = "force-dynamic";

/**
 * GP-side open/download for a library document's file.
 *
 * The bucket is private, so there is no URL to link to directly: the browser
 * asks here, the request is scoped to the caller's org by RLS, and only then is
 * a short-lived signed URL minted and redirected to. A linked document (one
 * whose `storage_key` is somebody else's http(s) URL) redirects straight out.
 *
 * `?version=<id>` opens the file a previous version pointed at, which is how a
 * replaced file stays readable without being restored first. `?download=1`
 * saves rather than renders, naming the file after the document rather than
 * after the uuid it is stored under.
 */
export async function GET(
  req: Request,
  props: { params: Promise<{ id: string }> },
) {
  const params = await props.params;
  const ctx = await getSessionContext();
  if (!ctx?.orgId) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const supabase = await createServerClient();
  const { data } = await supabase
    .from("documents")
    .select("*")
    .eq("id", params.id)
    .eq("organization_id", ctx.orgId)
    .maybeSingle();
  const doc = data as Document | null;
  if (!doc) return NextResponse.json({ error: "Not found" }, { status: 404 });

  let name = doc.name;
  let key = doc.storage_key;

  const versionId = new URL(req.url).searchParams.get("version");
  if (versionId) {
    const { data: vRow } = await supabase
      .from("document_versions")
      .select("*")
      .eq("id", versionId)
      .eq("document_id", params.id)
      .eq("organization_id", ctx.orgId)
      .maybeSingle();
    const version = vRow as DocumentVersion | null;
    if (!version) return NextResponse.json({ error: "Not found" }, { status: 404 });
    name = version.name;
    key = version.storage_key ?? null;
  }

  if (isExternalLink(key)) return NextResponse.redirect(key as string);
  if (!isUploadedFile(key)) {
    return NextResponse.json({ error: "This document has no file" }, { status: 404 });
  }

  const url = new URL(req.url);
  const signed = await signDocumentUrl(key as string, {
    ...(url.searchParams.get("download")
      ? { download: downloadFileName(name, key as string) }
      : {}),
  });
  if (!signed) {
    return NextResponse.json({ error: "File storage is unavailable" }, { status: 503 });
  }
  return NextResponse.redirect(signed);
}
