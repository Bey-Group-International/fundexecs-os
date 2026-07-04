import { NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";
import { createAnnotation, listAnnotations } from "@/lib/annotations";
import type { EntityType } from "@/lib/annotations";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const supabase = await createServerClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const entityType = searchParams.get("entityType") as EntityType | null;
  const entityId = searchParams.get("entityId");

  if (!entityType || !entityId) {
    return NextResponse.json({ error: "entityType and entityId required" }, { status: 400 });
  }

  const annotations = await listAnnotations(entityType, entityId);
  return NextResponse.json(annotations);
}

export async function POST(req: Request) {
  const supabase = await createServerClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  const { orgId, entityType, entityId, content, positionJson, parentId } = body;

  if (!orgId || !entityType || !entityId || !content) {
    return NextResponse.json({ error: "orgId, entityType, entityId, content required" }, { status: 400 });
  }

  const annotation = await createAnnotation({
    orgId,
    entityType,
    entityId,
    authorId: user.id,
    content,
    positionJson,
    parentId,
  });

  return NextResponse.json(annotation, { status: 201 });
}
