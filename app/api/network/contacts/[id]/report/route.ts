// GET /api/network/contacts/[id]/report?format=pdf|docx|md|html|rtf&messages=1
//
// One person's full communications report — every inbox conversation and every
// meeting linked to them, in one document. Built from the contact's timeline
// links and the summaries the inbox and meeting reports already hold, so it
// costs a handful of indexed reads and no model calls (lib/crm/contact-report*).
//
// Read through the caller's own session client: a private contact 404s, and a
// meeting report the caller may not read is stated as unavailable rather than
// included. `messages=1` adds each conversation's most recent messages; off by
// default for the same reason the meeting export makes the transcript opt-in.

import { NextRequest, NextResponse } from "next/server";
import { requireOrgContext } from "@/lib/auth";
import { createServerClient } from "@/lib/supabase/server";
import { checkRateLimit, rateLimitHeaders } from "@/lib/rate-limit";
import {
  EXPORT_CONTENT_TYPES,
  exportExtension,
  isBinaryFormat,
  isExportFormat,
  renderArtifact,
} from "@/lib/artifacts/export";
import { renderArtifactBinary } from "@/lib/artifacts/export-binary";
import { rendererDrawsTitle } from "@/lib/meetings/report-export";
import { buildContactReportMarkdown, contactReportFilename } from "@/lib/crm/contact-report";
import { loadContactReport } from "@/lib/crm/contact-report.server";

export const dynamic = "force-dynamic";

const LIMIT_PER_MIN = 20;

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireOrgContext();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const policy = { key: `org:${auth.ctx.orgId}:contact-report`, limit: LIMIT_PER_MIN, windowMs: 60_000 };
  const rateLimit = checkRateLimit(policy);
  if (!rateLimit.ok) {
    return NextResponse.json(
      { error: "Rate limit exceeded" },
      { status: 429, headers: rateLimitHeaders(rateLimit, policy.limit) },
    );
  }

  const { id } = await ctx.params;
  const format = req.nextUrl.searchParams.get("format") ?? "pdf";
  if (!isExportFormat(format)) {
    return NextResponse.json({ error: "Unsupported format" }, { status: 400 });
  }
  const includeMessages = req.nextUrl.searchParams.get("messages") === "1";

  const supabase = await createServerClient();
  let loaded;
  try {
    loaded = await loadContactReport(supabase as never, {
      orgId: auth.ctx.orgId,
      contactId: id,
      includeMessages,
    });
  } catch (err) {
    console.error("[network/contacts/report] load", err);
    return NextResponse.json({ error: "Failed to build the report" }, { status: 500 });
  }
  if (!loaded) return NextResponse.json({ error: "Contact not found" }, { status: 404 });

  const markdown = buildContactReportMarkdown(loaded, {
    includeMessages,
    titleHeading: !rendererDrawsTitle(format),
  });
  const name = loaded.contact.fullName || loaded.contact.email || "Contact";
  const title = `${name} — Communications Report`;
  const filename = contactReportFilename(name, loaded.generatedAt, exportExtension(format));

  const headers = {
    "Content-Type": EXPORT_CONTENT_TYPES[format],
    "Content-Disposition": `attachment; filename="${filename}"`,
    // Somebody's correspondence; never from a shared cache, and the next
    // message changes it anyway.
    "Cache-Control": "no-store",
  };

  if (isBinaryFormat(format)) {
    const bytes = await renderArtifactBinary(format, markdown, title);
    const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
    return new NextResponse(buffer, { status: 200, headers });
  }
  return new NextResponse(renderArtifact(format, markdown, title), { status: 200, headers });
}
