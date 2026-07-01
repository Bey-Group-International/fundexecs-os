import { NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";
import { resolveAnnotation } from "@/lib/annotations";

export const runtime = "nodejs";

export async function PATCH(
  _req: Request,
  { params }: { params: { id: string } },
) {
  const supabase = createServerClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  await resolveAnnotation(params.id, user.id);
  return NextResponse.json({ ok: true });
}
