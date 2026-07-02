import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";
import { getSessionContext } from "@/lib/auth";
import type { Document, Organization } from "@/lib/supabase/database.types";

// Minimal markdown → HTML (handles headings, bold, italic, lists, paragraphs).
// Full markdown isn't needed — GP docs are structured prose, not GH-flavored md.
function mdToHtml(md: string): string {
  const lines = md.split("\n");
  const out: string[] = [];
  let inList = false;

  for (const raw of lines) {
    const line = raw.trimEnd();

    // Headings
    const h = line.match(/^(#{1,6})\s+(.*)/);
    if (h) {
      if (inList) { out.push("</ul>"); inList = false; }
      const level = h[1].length;
      out.push(`<h${level}>${inline(h[2])}</h${level}>`);
      continue;
    }

    // Bullet lists
    const li = line.match(/^[-*]\s+(.*)/);
    if (li) {
      if (!inList) { out.push("<ul>"); inList = true; }
      out.push(`<li>${inline(li[1])}</li>`);
      continue;
    }

    if (inList) { out.push("</ul>"); inList = false; }

    // Horizontal rules
    if (/^-{3,}$/.test(line)) { out.push("<hr />"); continue; }

    // Blank lines → paragraph breaks
    if (line === "") { out.push("<br />"); continue; }

    out.push(`<p>${inline(line)}</p>`);
  }

  if (inList) out.push("</ul>");
  return out.join("\n");
}

function inline(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\*(.+?)\*/g, "<em>$1</em>")
    .replace(/`(.+?)`/g, "<code>$1</code>");
}

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  const ctx = await getSessionContext();
  if (!ctx?.orgId) return new NextResponse("Unauthorized", { status: 401 });

  const supabase = createServerClient();
  const [docRes, orgRes] = await Promise.all([
    supabase
      .from("documents")
      .select("*")
      .eq("id", params.id)
      .eq("organization_id", ctx.orgId)
      .maybeSingle(),
    supabase.from("organizations").select("name, brand_color, logo_url").eq("id", ctx.orgId).maybeSingle(),
  ]);

  const doc = docRes.data as Document | null;
  if (!doc) return new NextResponse("Not found", { status: 404 });

  const org = orgRes.data as Pick<Organization, "name" | "brand_color" | "logo_url"> | null;
  const accent = org?.brand_color && /^#[0-9a-fA-F]{3,8}$/.test(org.brand_color) ? org.brand_color : "#D4AF6A";

  // External link documents → redirect to the source URL.
  if (doc.mime_type === "text/uri-list" && doc.storage_key) {
    return NextResponse.redirect(doc.storage_key);
  }

  const body = mdToHtml(doc.content ?? "*(No content yet)*");
  const filename = doc.name.replace(/[^a-zA-Z0-9-_ ]/g, "").trim() || "document";

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escHtml(doc.name)} — ${escHtml(org?.name ?? "")}</title>
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&display=swap');

    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

    body {
      font-family: 'Inter', system-ui, sans-serif;
      font-size: 13px;
      line-height: 1.7;
      color: #1a1a1a;
      background: #fff;
      padding: 48px 64px;
      max-width: 820px;
      margin: 0 auto;
    }

    header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      border-bottom: 2px solid ${accent};
      padding-bottom: 16px;
      margin-bottom: 32px;
    }
    header .firm { font-size: 15px; font-weight: 600; }
    header .docname { font-size: 11px; text-transform: uppercase; letter-spacing: 0.1em; color: #666; }

    h1 { font-size: 22px; font-weight: 600; margin: 24px 0 12px; color: #111; }
    h2 { font-size: 16px; font-weight: 600; margin: 20px 0 8px; color: #222; border-left: 3px solid ${accent}; padding-left: 8px; }
    h3 { font-size: 13px; font-weight: 600; margin: 16px 0 6px; color: #333; }
    h4, h5, h6 { font-size: 12px; font-weight: 600; margin: 12px 0 4px; }

    p { margin: 8px 0; }
    ul { margin: 8px 0 8px 20px; }
    li { margin: 4px 0; }
    hr { border: none; border-top: 1px solid #e5e5e5; margin: 20px 0; }
    code { background: #f4f4f4; padding: 1px 4px; border-radius: 3px; font-size: 11px; }
    strong { font-weight: 600; }

    footer {
      margin-top: 48px;
      padding-top: 12px;
      border-top: 1px solid #e5e5e5;
      font-size: 10px;
      color: #999;
      display: flex;
      justify-content: space-between;
    }

    @media print {
      body { padding: 0; }
      .no-print { display: none !important; }
      @page { margin: 20mm 18mm; }
    }
  </style>
</head>
<body>
  <div class="no-print" style="position:fixed;top:12px;right:16px;z-index:100;display:flex;gap:8px;">
    <button onclick="window.print()" style="background:${accent};color:#000;border:none;border-radius:6px;padding:7px 18px;font-size:12px;font-weight:600;cursor:pointer;">
      Download / Print PDF
    </button>
  </div>

  <header>
    <div>
      <div class="firm">${escHtml(org?.name ?? "")}</div>
      <div class="docname">${escHtml(doc.name)}</div>
    </div>
    <div style="font-size:10px;color:#999;">Confidential</div>
  </header>

  <main>${body}</main>

  <footer>
    <span>${escHtml(org?.name ?? "")} · Confidential &amp; Proprietary</span>
    <span>${new Date().toLocaleDateString("en-US", { month: "long", year: "numeric" })}</span>
  </footer>
</body>
</html>`;

  return new NextResponse(html, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Content-Disposition": `inline; filename="${filename}.pdf"`,
      "X-Robots-Tag": "noindex",
    },
  });
}

function escHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
