// A shared clip of a recording, for somebody without an account. The token in
// the address is the only credential; see lib/meetings/recording-share.ts.
//
// What plays is the clip's own file, cut on the server when the link was made;
// the transcript is the lines said inside the window and no others. Each
// opening is written to the link's access log for the person who shared it.
import type { Metadata } from "next";
import { headers } from "next/headers";
import { Logo } from "@/components/Logo";
import { SITE_NAME } from "@/lib/site";
import { clientIp } from "@/lib/rate-limit";
import { createServiceClient, hasSupabaseServiceEnv } from "@/lib/supabase/server";
import type { CueRow } from "@/lib/meetings/transcript-cues";
import { readAllTranscriptRows } from "@/lib/meetings/transcript-read";
import { clipCues } from "@/lib/meetings/recording-share";
import { applyOverlay } from "@/lib/meetings/transcript-tools";
import { loadOverlay } from "@/lib/meetings/transcript-tools.server";
import { guardClipRequest, noteMiss, overHourlyCap, recordOpen, recordView, resolveShare } from "@/lib/meetings/recording-share.server";
import { ClipView } from "./ClipView";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: `Shared clip — ${SITE_NAME}`,
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

function Unavailable({ message }: { message: string }) {
  return (
    <div className="fx-blueprint min-h-screen bg-surface-0 px-4 py-12">
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-6">
        <Logo />
        <p className="text-sm text-[var(--fg-secondary)]">{message}</p>
      </div>
    </div>
  );
}

export default async function ClipPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const h = await headers();
  const ip = clientIp(new Request("http://clip.local", { headers: h }));
  if (guardClipRequest(ip, "page")) return <Unavailable message="Too many requests. Wait a few minutes and try again." />;
  if (!hasSupabaseServiceEnv()) return <Unavailable message="Shared clips aren't available right now." />;
  const service = createServiceClient();
  const resolved = await resolveShare(service, token);
  if ("failure" in resolved) {
    if (resolved.failure === "not_found") noteMiss(ip);
    return (
      <Unavailable
        message={
          resolved.failure === "expired"
            ? "This link has expired. Ask the person who sent it for a new one."
            : resolved.failure === "revoked"
              ? "This link was turned off by the person who shared it."
              : resolved.failure === "deleted"
                ? "This recording has passed its retention period and was deleted."
                : "This link is invalid."
        }
      />
    );
  }
  const share = resolved.share;
  if (share.clip_status === "failed") {
    return <Unavailable message="This clip couldn't be prepared. Ask the person who sent it for a new link." />;
  }
  if (share.clip_status !== "ready") {
    return <Unavailable message="This clip is still being prepared. Refresh this page in a minute." />;
  }
  if (await overHourlyCap(service, share.id)) {
    return <Unavailable message="This link has been opened a lot in the last hour. Try again later." />;
  }
  await Promise.all([
    recordOpen(service, share),
    recordView(service, share, { ip, userAgent: h.get("user-agent") }, "open"),
  ]);

  const baseMs = share.clip_offset_ms ?? share.start_ms;
  let cues: ReturnType<typeof clipCues> = [];
  try {
    const rows = await readAllTranscriptRows<CueRow>((from, to) =>
      service
        .from("live_meeting_transcripts")
        .select("id, speaker, text, ts, confidence, overlapped")
        .eq("meeting_id", share.meeting_id)
        .order("ts", { ascending: true })
        .range(from, to) as never,
    );
    // With the host's speaker names and corrections, as everywhere else it is read.
    const shown = applyOverlay(rows, await loadOverlay(service as unknown as { from: (t: string) => any }, share.meeting_id));
    cues = clipCues(shown, resolved.recording.started_at, { startMs: share.start_ms, endMs: share.end_ms }, baseMs).map(
      ({ lineIds: _ids, originals: _originals, ...c }) => c,
    );
  } catch {
    // The clip plays without its transcript.
  }

  return (
    <div className="fx-blueprint min-h-screen bg-surface-0 px-4 py-10">
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
        <Logo />
        <ClipView
          token={token}
          title={share.label || resolved.meetingTitle}
          meetingTitle={resolved.meetingTitle}
          meetingId={share.meeting_id}
          recordingId={share.recording_id}
          startMs={share.start_ms}
          endMs={share.end_ms}
          baseMs={baseMs}
          expiresAt={share.expires_at}
          allowDownload={share.allow_download === true}
          cues={cues}
        />
      </div>
    </div>
  );
}
