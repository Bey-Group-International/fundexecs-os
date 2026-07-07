import { NextRequest, NextResponse } from "next/server";
import { requireOrgContext } from "@/lib/auth";
import { importContacts, parseNetworkCsv } from "@/lib/network-import";
import type { ImportMode } from "@/lib/network-import";
import { checkRateLimit, rateLimitHeaders } from "@/lib/rate-limit";
import { validateFileType } from "@/lib/file-validation";
import { xlsxToRows, rowsToCsv } from "@/lib/xlsx";

export const dynamic = "force-dynamic";

const MAX_IMPORT_BYTES = 2_000_000;
const MAX_IMPORT_ROWS = 5_000;

export async function POST(req: NextRequest) {
  const auth = await requireOrgContext();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const rateLimit = checkRateLimit({
    key: `org:${auth.ctx.orgId}:network-import`,
    limit: 10,
    windowMs: 60_000,
  });
  if (!rateLimit.ok) {
    return NextResponse.json(
      { error: "Rate limit exceeded" },
      { status: 429, headers: rateLimitHeaders(rateLimit, 10) },
    );
  }

  const contentType = req.headers.get("content-type") ?? "";
  const modeHint = (req.nextUrl.searchParams.get("mode") ?? "auto") as ImportMode;

  try {
    if (contentType.includes("multipart/form-data")) {
      const form = await req.formData();
      const file = form.get("file") as File | null;
      if (!file) return NextResponse.json({ error: "No file uploaded" }, { status: 400 });
      if (file.size > MAX_IMPORT_BYTES) {
        return NextResponse.json(
          { error: "CSV import is limited to 2 MB. Split the file and try again." },
          { status: 413 },
        );
      }

      // Auto-detect the real type from bytes + MIME, not just the extension,
      // so a mislabeled or unsupported file is rejected with a clear message.
      const bytes = new Uint8Array(await file.arrayBuffer());
      const check = validateFileType(
        { name: file.name, mime: file.type, head: bytes.subarray(0, 512) },
        { accept: ["csv", "xlsx"] },
      );
      if (!check.ok) {
        return NextResponse.json({ error: check.error }, { status: 400 });
      }

      // Read CSV directly; unwrap XLSX into CSV text so both flow through the
      // same header-detection + normalization pipeline.
      let csvText: string;
      if (check.kind === "xlsx") {
        try {
          csvText = rowsToCsv(await xlsxToRows(bytes));
        } catch (e) {
          const msg = e instanceof Error ? e.message : "Could not read that Excel workbook.";
          return NextResponse.json({ error: msg }, { status: 400 });
        }
      } else {
        csvText = new TextDecoder("utf-8").decode(bytes);
      }
      if (!csvText.trim()) return NextResponse.json({ error: "Empty file" }, { status: 400 });
      const contacts = parseNetworkCsv(csvText, modeHint);
      if (contacts.length > MAX_IMPORT_ROWS) {
        return NextResponse.json(
          { error: "CSV import is limited to 5,000 rows. Split the file and try again." },
          { status: 413 },
        );
      }
      if (contacts.length === 0) return NextResponse.json({ error: "No valid contacts found in CSV" }, { status: 400 });
      const result = await importContacts(contacts);
      return NextResponse.json(result);
    }

    // JSON body fallback (csv string)
    const body = await req.json().catch(() => ({}));
    if (!body.csv?.trim()) return NextResponse.json({ error: "No data provided" }, { status: 400 });
    const contacts = parseNetworkCsv(body.csv, modeHint);
    if (contacts.length > MAX_IMPORT_ROWS) {
      return NextResponse.json(
        { error: "CSV import is limited to 5,000 rows. Split the file and try again." },
        { status: 413 },
      );
    }
    const result = await importContacts(contacts);
    return NextResponse.json(result);

  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Import failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
