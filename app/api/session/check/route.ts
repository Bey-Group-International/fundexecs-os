import { NextResponse } from "next/server";
import { getSessionContext } from "@/lib/auth";

// Lightweight "is my cookie session still valid?" probe for the mobile app.
// On-the-go operators leave the PWA backgrounded for hours; when they resume,
// the client pings this route to distinguish an expired login (needs re-auth)
// from a transient network blip. Session-cookie based only — API-key callers
// are irrelevant here.
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const ctx = await getSessionContext();
    // A context object means the auth cookie resolved to a real user; null/
    // undefined means the session is gone (expired or signed out).
    if (ctx) return NextResponse.json({ ok: true });
  } catch {
    /* ignore — treat any auth failure as an expired/absent session */
  }
  return NextResponse.json({ ok: false }, { status: 401 });
}
