import { NextResponse } from "next/server";
import { requireOrgContext } from "@/lib/auth";
import { createServerClient } from "@/lib/supabase/server";
import { requireOrgAdmin } from "@/lib/rbac";
import type { AuditLog } from "@/lib/supabase/database.types";

export const dynamic = "force-dynamic";

const CSV_COLUMNS = [
  "created_at",
  "action",
  "entity_type",
  "entity_id",
  "principal_id",
  "ip_address",
  "before_state",
  "after_state",
] as const;

function csvCell(value: unknown): string {
  const raw = value == null
    ? ""
    : typeof value === "string"
      ? value
      : JSON.stringify(value);
  return `"${raw.replace(/"/g, '""')}"`;
}

export async function GET() {
  const auth = await requireOrgContext();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const admin = requireOrgAdmin(auth.ctx.role);
  if (!admin.ok) return NextResponse.json({ error: admin.error }, { status: admin.status });

  const supabase = await createServerClient();
  const { data, error } = await supabase
    .from("audit_log")
    .select("*")
    .eq("organization_id", auth.ctx.orgId)
    .order("created_at", { ascending: false })
    .limit(5000);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const rows = (data ?? []) as AuditLog[];
  const csv = [
    CSV_COLUMNS.join(","),
    ...rows.map((row) => CSV_COLUMNS.map((col) => csvCell(row[col])).join(",")),
  ].join("\n");

  return new Response(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="fundexecs-audit-${new Date().toISOString().slice(0, 10)}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
