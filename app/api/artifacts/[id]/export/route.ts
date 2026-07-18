import { NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";
import { requireOrgContext } from "@/lib/auth";
import {
  EXPORT_CONTENT_TYPES,
  exportExtension,
  isExportFormat,
  renderArtifact,
} from "@/lib/artifacts/export";

// GET /api/artifacts/[id]/export?format=rtf|html|md — render an artifact's
// markdown `content` into a downloadable document. Org-scoped via
// requireOrgContext() + an explicit organization_id filter (defense-in-depth
// alongside RLS) so an artifact can never be exported across orgs.
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const auth = await requireOrgContext();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const format = new URL(request.url).searchParams.get("format") ?? "rtf";
  if (!isExportFormat(format)) {
    return NextResponse.json({ error: "Unsupported format" }, { status: 400 });
  }

  const supabase = await createServerClient();
  const { data: artifact } = await supabase
    .from("artifacts")
    .select("title, content, artifact_type")
    .eq("id", id)
    .eq("organization_id", auth.ctx.orgId)
    .maybeSingle();

  if (!artifact) {
    return NextResponse.json({ error: "Artifact not found" }, { status: 404 });
  }

  const body = renderArtifact(format, artifact.content ?? "", artifact.title ?? undefined);

  const slug =
    (artifact.title ?? "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "artifact";
  const filename = `${slug}.${exportExtension(format)}`;

  return new NextResponse(body, {
    status: 200,
    headers: {
      "Content-Type": EXPORT_CONTENT_TYPES[format],
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
