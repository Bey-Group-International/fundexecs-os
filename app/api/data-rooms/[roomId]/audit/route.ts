import { NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";
import { getSessionContext } from "@/lib/auth";
import {
  buildAuditCsv,
  auditFilename,
  type AuditView,
  type AuditShare,
  type AuditDoc,
} from "@/lib/data-room-audit";
import type { DataRoom } from "@/lib/supabase/database.types";

export const dynamic = "force-dynamic";

// Audit trail export: the access log for one room as a CSV a compliance team
// can archive. Members of the owning org only — every query is filtered by the
// caller's org id, and the room is re-checked against it before anything is
// read, so a room id from another firm returns 404 rather than a file.
export async function GET(_req: Request, props: { params: Promise<{ roomId: string }> }) {
  const params = await props.params;
  const ctx = await getSessionContext();
  if (!ctx?.orgId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const orgId = ctx.orgId;

  const supabase = await createServerClient();
  const { data: roomRow } = await supabase
    .from("data_rooms")
    .select("*")
    .eq("id", params.roomId)
    .eq("organization_id", orgId)
    .maybeSingle();
  const room = roomRow as DataRoom | null;
  if (!room) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // Views carry room_id only from the rooms migration onward, so older rows are
  // picked up through their share instead. Without this, a room's early history
  // would silently vanish from its own audit trail.
  const { data: shareRows } = await supabase
    .from("data_room_shares")
    .select("id, label, recipient_email")
    .eq("organization_id", orgId)
    .eq("room_id", room.id);
  const shares: AuditShare[] = (
    (shareRows ?? []) as { id: string; label: string | null; recipient_email: string | null }[]
  ).map((s) => ({ id: s.id, label: s.label, recipientEmail: s.recipient_email }));
  const shareIds = shares.map((s) => s.id);

  const { data: viewRows } = await supabase
    .from("data_room_views")
    .select("created_at, kind, share_id, document_id, viewer_email, session_id, duration_seconds")
    .eq("organization_id", orgId)
    .or(
      shareIds.length
        ? `room_id.eq.${room.id},share_id.in.(${shareIds.join(",")})`
        : `room_id.eq.${room.id}`,
    )
    .order("created_at", { ascending: false })
    .limit(10_000);

  const views: AuditView[] = (
    (viewRows ?? []) as {
      created_at: string;
      kind: "room" | "document";
      share_id: string | null;
      document_id: string | null;
      viewer_email: string | null;
      session_id: string | null;
      duration_seconds: number | null;
    }[]
  ).map((v) => ({
    createdAt: v.created_at,
    kind: v.kind,
    shareId: v.share_id,
    documentId: v.document_id,
    viewerEmail: v.viewer_email,
    sessionId: v.session_id,
    durationSeconds: v.duration_seconds,
  }));

  const docIds = [...new Set(views.map((v) => v.documentId).filter((id): id is string => !!id))];
  let docs: AuditDoc[] = [];
  if (docIds.length) {
    const { data: docRows } = await supabase
      .from("documents")
      .select("id, name")
      .eq("organization_id", orgId)
      .in("id", docIds);
    docs = ((docRows ?? []) as { id: string; name: string }[]).map((d) => ({
      id: d.id,
      name: d.name,
    }));
  }

  // Lead with a UTF-8 BOM: without it Excel decodes the file as the local
  // codepage and accented investor names arrive as mojibake.
  const csv = "\uFEFF" + buildAuditCsv({ roomName: room.name, views, shares, docs });

  return new NextResponse(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${auditFilename(room.name)}"`,
      "Cache-Control": "no-store",
    },
  });
}
