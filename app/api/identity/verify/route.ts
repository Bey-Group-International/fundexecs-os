import { NextResponse } from "next/server";
import { getIdentityVerificationProvider } from "@/lib/providers";
import type { IdentityVerificationParams } from "@/lib/providers";
import { createServerClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const supabase = await createServerClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await req.json() as Partial<IdentityVerificationParams>;
    if (!body.subjectId || !body.subjectName || !body.level || !body.subjectType) {
      return NextResponse.json(
        { error: "subjectId, subjectName, subjectType, and level are required" },
        { status: 400 },
      );
    }

    const provider = getIdentityVerificationProvider();
    const result = await provider.initiate({
      orgId: body.orgId ?? "",
      subjectId: body.subjectId,
      subjectType: body.subjectType,
      subjectName: body.subjectName,
      subjectEmail: body.subjectEmail,
      level: body.level,
      requestedBy: body.requestedBy ?? "api",
    });

    return NextResponse.json({ provider: provider.name, ...result });
  } catch (err) {
    console.error("[/api/identity/verify]", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
