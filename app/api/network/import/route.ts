import { NextRequest, NextResponse } from "next/server";
import { requireOrgContext } from "@/lib/auth";
import { importContacts, parseLinkedInCsv, parseXlsx } from "@/lib/network-import";
import type { ImportMode } from "@/lib/network-import";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const auth = await requireOrgContext();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const contentType = req.headers.get("content-type") ?? "";
  const modeHint = (req.nextUrl.searchParams.get("mode") ?? "auto") as ImportMode;

  try {
    if (contentType.includes("multipart/form-data")) {
      const form = await req.formData();
      const file = form.get("file") as File | null;
      if (!file) return NextResponse.json({ error: "No file uploaded" }, { status: 400 });

      const name = file.name.toLowerCase();

      if (name.endsWith(".xlsx") || name.endsWith(".xls")) {
        const buffer = await file.arrayBuffer();
        const contacts = parseXlsx(buffer, modeHint);
        if (contacts.length === 0) return NextResponse.json({ error: "No valid contacts found in spreadsheet" }, { status: 400 });
        const result = await importContacts(contacts);
        return NextResponse.json(result);
      }

      // CSV (LinkedIn export or generic)
      const csvText = await file.text();
      if (!csvText.trim()) return NextResponse.json({ error: "Empty file" }, { status: 400 });
      const contacts = parseLinkedInCsv(csvText);
      if (contacts.length === 0) return NextResponse.json({ error: "No valid contacts found in CSV" }, { status: 400 });
      const result = await importContacts(contacts);
      return NextResponse.json(result);
    }

    // JSON body fallback (csv string)
    const body = await req.json().catch(() => ({}));
    if (!body.csv?.trim()) return NextResponse.json({ error: "No data provided" }, { status: 400 });
    const contacts = parseLinkedInCsv(body.csv);
    const result = await importContacts(contacts);
    return NextResponse.json(result);

  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Import failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
