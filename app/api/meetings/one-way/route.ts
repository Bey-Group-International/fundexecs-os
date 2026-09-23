// app/api/meetings/one-way/route.ts
// Opening a session to record a call into.
//
// A one-way session is a live_meetings row with `kind = 'one_way'`, which is
// what lets everything downstream — the recording bucket's read policy, the
// expiry sweep, the delete cleanup, the transcript rows, the report, the
// export — work on it with no changes at all. See lib/meetings/one-way.ts for
// why that shape and not a table of its own.
//
// The row is created BEFORE recording starts, because the recording needs a
// meeting id to key its objects on, and because the consent acknowledgement is
// part of the row rather than something attached afterwards: a session that
// exists without one is a session nothing should have recorded.
import { NextRequest, NextResponse } from "next/server";
import { requireOrgContext } from "@/lib/auth";
import { createServerClient } from "@/lib/supabase/server";
import { createMeeting } from "@/lib/meetings/service";
import {
  ONE_WAY_KIND,
  acknowledgement,
  callTitle,
  captureSources,
  mayStartRecording,
  blockedReason,
} from "@/lib/meetings/one-way";
import type { Json } from "@/lib/supabase/database.types";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const auth = await requireOrgContext();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const body = (await req.json().catch(() => ({}))) as {
    title?: unknown;
    disclosure?: unknown;
    acknowledged?: unknown;
    computerAudio?: unknown;
  };

  const disclosure = typeof body.disclosure === "string" ? body.disclosure : "";
  const sources = captureSources(body.computerAudio === true);
  const gate = {
    acknowledged: body.acknowledged === true,
    disclosure,
    sources,
  };

  // Refused here and not only in the UI. The button is the polite half; this
  // is the half that holds when somebody calls the route directly, and a
  // recording session that exists without an acknowledgement is exactly what
  // the acknowledgement is for.
  if (!mayStartRecording(gate)) {
    return NextResponse.json(
      { error: blockedReason(gate) ?? "Consent has not been acknowledged." },
      { status: 400 },
    );
  }

  const supabase = await createServerClient();
  const title = callTitle(typeof body.title === "string" ? body.title : null);

  try {
    const meeting = await createMeeting(supabase, {
      title,
      orgId: auth.ctx.orgId,
      hostId: auth.ctx.userId,
      dealId: null,
      roomCode: null,
      scheduledAt: null,
      durationMinutes: null,
      timezone: null,
      meetingType: null,
      kind: ONE_WAY_KIND,
      recordingConsent: acknowledgement({ disclosure, sources }) as unknown as Json,
    });

    return NextResponse.json({ id: meeting.id, roomCode: meeting.roomCode, title });
  } catch (err) {
    console.error("[/api/meetings/one-way]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Could not start the call" },
      { status: 500 },
    );
  }
}
