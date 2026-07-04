import { NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function GET() {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const apiKey = process.env.METERED_API_KEY;
  const appName = process.env.METERED_APP_NAME ?? "fundexecs";

  // Fallback to Google STUN if Metered is not configured
  if (!apiKey) {
    return NextResponse.json({
      iceServers: [
        { urls: "stun:stun.l.google.com:19302" },
        { urls: "stun:stun1.l.google.com:19302" },
      ],
    });
  }

  try {
    const res = await fetch(
      `https://${appName}.metered.live/api/v1/turn/credentials?apiKey=${apiKey}`,
      { next: { revalidate: 3540 } }, // cache 59 min (credentials valid 1 hr)
    );
    if (!res.ok) throw new Error(`Metered returned ${res.status}`);
    const servers = await res.json() as RTCIceServer[];
    return NextResponse.json({ iceServers: servers });
  } catch (err) {
    console.error("[/api/meetings/ice-servers]", err);
    // Fallback to STUN so meetings still work
    return NextResponse.json({
      iceServers: [
        { urls: "stun:stun.l.google.com:19302" },
        { urls: "stun:stun1.l.google.com:19302" },
      ],
    });
  }
}
