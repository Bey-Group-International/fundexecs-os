// Platform-admin report API — the "backend" behind the admin console.
//
// GET /api/admin/report → the full cross-org traction report as JSON.
// GET /api/admin/report?format=csv → the signups list as a CSV download.
//
// Gated by requirePlatformAdmin(): only @beygroupintl.com (or an ADMIN_EMAILS
// allowlisted) session may call it. Everyone else gets 401/403. The heavy,
// RLS-bypassing reads live in lib/admin/reports.ts and are only reachable past
// this gate.
import { NextResponse } from "next/server";
import { requirePlatformAdmin } from "@/lib/platform-admin";
import { getAdminReport, type SignupRow } from "@/lib/admin/reports";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const gate = await requirePlatformAdmin();
  if (!gate.ok) {
    return NextResponse.json(
      { error: gate.status === 401 ? "Not authenticated" : "Forbidden" },
      { status: gate.status },
    );
  }

  const report = await getAdminReport();

  const format = new URL(request.url).searchParams.get("format");
  if (format === "csv") {
    const csv = signupsToCsv(report.signups);
    return new NextResponse(csv, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="signups-${report.generatedAt.slice(0, 10)}.csv"`,
        "Cache-Control": "no-store",
      },
    });
  }

  return NextResponse.json(report, {
    headers: { "Cache-Control": "no-store" },
  });
}

function signupsToCsv(rows: SignupRow[]): string {
  const header = [
    "email",
    "full_name",
    "title",
    "organization",
    "role",
    "signed_up_at",
    "sessions_started",
    "actions",
    "last_active_at",
  ];
  const lines = [header.join(",")];
  for (const r of rows) {
    lines.push(
      [
        r.email,
        r.fullName ?? "",
        r.title ?? "",
        r.orgName ?? "",
        r.role ?? "",
        r.createdAt,
        String(r.sessionsStarted),
        String(r.auditActions),
        r.lastActiveAt ?? "",
      ]
        .map(csvCell)
        .join(","),
    );
  }
  return lines.join("\n");
}

// RFC-4180 quoting: wrap in quotes and double any embedded quotes when the value
// contains a comma, quote, or newline. Guards against CSV injection by prefixing
// a value that starts with a formula trigger.
function csvCell(value: string): string {
  const sanitized = /^[=+\-@]/.test(value) ? `'${value}` : value;
  if (/[",\n\r]/.test(sanitized)) {
    return `"${sanitized.replace(/"/g, '""')}"`;
  }
  return sanitized;
}
