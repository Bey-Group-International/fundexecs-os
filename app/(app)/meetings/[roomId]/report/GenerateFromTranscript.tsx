"use client";

// The button the stalled report page used to point at without showing.
//
// A report that never arrived told the reader to "regenerate the report from
// the meeting log". The log's button was gated on a report row's transcript
// flag, and a meeting whose report never arrived usually has no report row —
// so the page sent the host to a button that was not there. The route can
// write a first report from the stored rows now, and this is the button, on
// the page that needs it, shown to the one person the route will accept.
import { useState } from "react";
import { useRouter } from "next/navigation";

export function GenerateFromTranscript({ meetingId }: { meetingId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function generate() {
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch(`/api/meetings/${encodeURIComponent(meetingId)}/report/regenerate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        // 409 is the honest case: nothing was transcribed, so there is nothing
        // to write a report from. The route says so in its own words.
        setMessage(json.error ?? "The report could not be generated.");
        return;
      }
      // The server decides what to show next — a report, or a finished empty
      // one — exactly as it does when the waiting poll sees a report land.
      router.refresh();
    } catch {
      setMessage("The report could not be generated. Check your connection.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col items-center gap-2">
      <button
        type="button"
        onClick={() => void generate()}
        disabled={busy}
        className="rounded-lg bg-[var(--gold-400)] px-3 py-1.5 text-xs font-semibold text-[#0d0d10] hover:opacity-90 disabled:opacity-60"
      >
        {busy ? "Reading the transcript…" : "Generate the report from the transcript"}
      </button>
      {message && (
        <p role="alert" className="text-xs text-[var(--status-danger)]">
          {message}
        </p>
      )}
    </div>
  );
}
