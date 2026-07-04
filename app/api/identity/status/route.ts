import { NextResponse } from "next/server";
import { getIdentityVerificationProvider } from "@/lib/providers";
import { createServerClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const supabase = await createServerClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { searchParams } = new URL(req.url);
    const verificationId = searchParams.get("verificationId");
    if (!verificationId) {
      return NextResponse.json({ error: "verificationId query param required" }, { status: 400 });
    }

    const provider = getIdentityVerificationProvider();
    const result = await provider.getStatus(verificationId);
    return NextResponse.json({ provider: provider.name, ...result });
  } catch (err) {
    console.error("[/api/identity/status]", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
