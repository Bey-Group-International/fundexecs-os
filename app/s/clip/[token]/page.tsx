// A shared clip of a recording, for somebody without an account. The token in
// the address is the only credential; see lib/meetings/recording-share.ts.
import type { Metadata } from "next";
import { Logo } from "@/components/Logo";
import { SITE_NAME } from "@/lib/site";
import { createServiceClient, hasSupabaseServiceEnv } from "@/lib/supabase/server";
import { transcriptCues, type CueRow } from "@/lib/meetings/transcript-cues";
import { readAllTranscriptRows } from "@/lib/meetings/transcript-read";
import { recordOpen, resolveShare } from "@/lib/meetings/recording-share.server";
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
  if (!hasSupabaseServiceEnv()) return <Unavailable message="Shared clips aren't available right now." />;
  const service = createServiceClient();
  const resolved = await resolveShare(service, token);
  if ("failure" in resolved) {
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
  await recordOpen(service, resolved.share);

  // The words said inside the window, timed against the recording.
  let cues: ReturnType<typeof transcriptCues> = [];
  try {
    const rows = await readAllTranscriptRows<CueRow>((from, to) =>
      service
        .from("live_meeting_transcripts")
        .select("speaker, text, ts, confidence, overlapped")
        .eq("meeting_id", resolved.share.meeting_id)
        .order("ts", { ascending: true })
        .range(from, to) as never,
    );
    const end = resolved.share.end_ms ?? Number.POSITIVE_INFINITY;
    cues = transcriptCues(rows, resolved.recording.started_at).filter((c) => c.atMs >= resolved.share.start_ms - 2_000 && c.atMs < end);
  } catch {
    // The clip plays without its transcript.
  }

  return (
    <div className="fx-blueprint min-h-screen bg-surface-0 px-4 py-10">
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
        <Logo />
        <ClipView
          token={token}
          title={resolved.share.label || resolved.meetingTitle}
          meetingTitle={resolved.meetingTitle}
          meetingId={resolved.share.meeting_id}
          recordingId={resolved.share.recording_id}
          startMs={resolved.share.start_ms}
          endMs={resolved.share.end_ms}
          expiresAt={resolved.share.expires_at}
          cues={cues}
        />
      </div>
    </div>
  );
}
