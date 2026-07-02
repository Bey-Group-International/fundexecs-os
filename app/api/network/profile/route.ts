import { NextRequest, NextResponse } from "next/server";
import { requireOrgContext } from "@/lib/auth";
import { getOutreachProfile, saveIntroBlurb, generateIntroBlurb } from "@/lib/network-outreach-profile";

export const dynamic = "force-dynamic";

// GET /api/network/profile — fetch outreach profile (org + user blurb)
export async function GET() {
  const auth = await requireOrgContext();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const profile = await getOutreachProfile();
  if (!profile) return NextResponse.json({ error: "Profile not found" }, { status: 404 });
  return NextResponse.json(profile);
}

// POST /api/network/profile — save blurb or generate one
// body: { action: "save", blurb: string } | { action: "generate" }
export async function POST(req: NextRequest) {
  const auth = await requireOrgContext();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const body = await req.json().catch(() => ({}));

  if (body.action === "save") {
    if (!body.blurb?.trim()) return NextResponse.json({ error: "blurb is required" }, { status: 400 });
    await saveIntroBlurb(body.blurb);
    return NextResponse.json({ ok: true });
  }

  if (body.action === "generate") {
    const profile = await getOutreachProfile();
    if (!profile) return NextResponse.json({ error: "Profile not found" }, { status: 404 });
    const blurb = await generateIntroBlurb(profile);
    return NextResponse.json({ blurb });
  }

  return NextResponse.json({ error: "action must be 'save' or 'generate'" }, { status: 400 });
}
