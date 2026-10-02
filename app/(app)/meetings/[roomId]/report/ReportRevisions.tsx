"use client";

// Fixing a report that came out wrong, and going back if the fix is worse.
//
// The model reads a transcript; the host was in the room. When the report gets
// something wrong — the follow-up addressed to the host instead of the people
// they met, an action item on the wrong person — the host knows why, and until
// now the only lever was "Regenerate" on the meeting log: the same transcript,
// the same prompt, and a hope that the dice landed differently.
//
// So the host says what is wrong, and that note goes to the model as overriding
// the transcript. Every version is kept, so a correction that makes things
// worse costs nothing: the earlier version is one press away.
import { useState } from "react";
import { useRouter } from "next/navigation";
import { MAX_CORRECTION_CHARS, type ReportVersion } from "@/lib/meetings/report-versions";

type History =
  | { kind: "closed" }
  | { kind: "loading" }
  | { kind: "loaded"; versions: ReportVersion[]; canRestore: boolean }
  | { kind: "failed"; message: string };

const EXAMPLES = [
  "The follow-up is to the invitee, not to me — I'm the host and I'm sending it.",
  "Mark owns sending the deck, not Sarah.",
  "We agreed to reconvene next Thursday, not next month.",
];

export function ReportRevisions({ meetingId, isHost }: { meetingId: string; isHost: boolean }) {
  const router = useRouter();
  const [correcting, setCorrecting] = useState(false);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState<"regenerating" | "restoring" | null>(null);
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [history, setHistory] = useState<History>({ kind: "closed" });

  async function loadHistory() {
    setHistory({ kind: "loading" });
    try {
      const res = await fetch(`/api/meetings/${meetingId}/report/versions`);
      const json = (await res.json().catch(() => ({}))) as {
        versions?: ReportVersion[];
        canRestore?: boolean;
        error?: string;
      };
      if (!res.ok) {
        setHistory({ kind: "failed", message: json.error ?? "The report history could not be read." });
        return;
      }
      setHistory({ kind: "loaded", versions: json.versions ?? [], canRestore: Boolean(json.canRestore) });
    } catch {
      setHistory({ kind: "failed", message: "The report history could not be read. Check your connection." });
    }
  }

  async function regenerate() {
    const correction = note.trim();
    if (!correction) return;
    setBusy("regenerating");
    setMessage(null);
    try {
      const res = await fetch(`/api/meetings/${meetingId}/report/regenerate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ correction }),
      });
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setMessage({ tone: "error", text: json.error ?? "The report could not be regenerated." });
        return;
      }
      setNote("");
      setCorrecting(false);
      setMessage({ tone: "ok", text: "Regenerated with your correction. The previous version is in the history." });
      if (history.kind !== "closed") void loadHistory();
      router.refresh();
    } catch {
      setMessage({ tone: "error", text: "The report could not be regenerated. Check your connection." });
    } finally {
      setBusy(null);
    }
  }

  async function restore(versionId: string) {
    setBusy("restoring");
    setMessage(null);
    try {
      const res = await fetch(`/api/meetings/${meetingId}/report/versions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ versionId }),
      });
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setMessage({ tone: "error", text: json.error ?? "That version could not be restored." });
        return;
      }
      setMessage({ tone: "ok", text: "Restored. The version it replaced is still in the history." });
      void loadHistory();
      router.refresh();
    } catch {
      setMessage({ tone: "error", text: "That version could not be restored. Check your connection." });
    } finally {
      setBusy(null);
    }
  }

  const historyOpen = history.kind !== "closed";

  return (
    <section className="rounded-xl border border-[var(--line)] bg-[var(--surface-1)] p-4 flex flex-col gap-3">
      <div className="flex flex-col gap-2">
        <p className="text-xs font-medium text-[var(--fg-secondary)] uppercase tracking-wide">
          Report versions
        </p>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
          {isHost && !correcting && (
            <button
              onClick={() => setCorrecting(true)}
              disabled={busy !== null}
              className="text-xs font-semibold text-[var(--gold-400)] hover:underline disabled:opacity-50"
            >
              Something wrong? Correct &amp; regenerate
            </button>
          )}
          <button
            onClick={() => (historyOpen ? setHistory({ kind: "closed" }) : void loadHistory())}
            className="text-xs text-[var(--fg-muted)] hover:text-[var(--fg-secondary)] transition-colors"
          >
            {historyOpen ? "Hide history" : "Show history"}
          </button>
        </div>
      </div>

      {isHost && correcting && (
        <div className="flex flex-col gap-2">
          <label htmlFor="report-correction" className="text-xs text-[var(--fg-muted)]">
            Tell the report what it got wrong. Your note overrides the transcript, and the current
            version is kept in the history.
          </label>
          <textarea
            id="report-correction"
            value={note}
            maxLength={MAX_CORRECTION_CHARS}
            onChange={(e) => setNote(e.target.value)}
            rows={3}
            placeholder={EXAMPLES[0]}
            className="w-full resize-y rounded-lg border border-[var(--line)] bg-[var(--surface-0)] p-3 text-sm leading-relaxed text-[var(--fg-primary)] focus:border-[var(--gold-400)] focus:outline-none"
          />
          <div className="flex flex-wrap gap-2">
            {EXAMPLES.map((example) => (
              <button
                key={example}
                type="button"
                onClick={() => setNote((current) => (current.trim() ? `${current.trim()}\n${example}` : example))}
                className="rounded-full border border-[var(--line)] px-2.5 py-1 text-[11px] text-[var(--fg-muted)] hover:text-[var(--fg-secondary)]"
              >
                {example}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <button
              onClick={() => void regenerate()}
              disabled={busy !== null || !note.trim()}
              className="rounded-lg bg-[var(--gold-400)] px-3 py-1.5 text-xs font-semibold text-[#0d0d10] transition-opacity disabled:opacity-50"
            >
              {busy === "regenerating" ? "Regenerating…" : "Regenerate with correction"}
            </button>
            <button
              onClick={() => {
                setCorrecting(false);
                setNote("");
              }}
              disabled={busy !== null}
              className="text-xs text-[var(--fg-muted)] hover:text-[var(--fg-secondary)] disabled:opacity-50"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {message && (
        <p
          role={message.tone === "error" ? "alert" : "status"}
          className={`text-xs ${
            message.tone === "error" ? "text-[var(--status-danger,#ef4444)]" : "text-[var(--fg-muted)]"
          }`}
        >
          {message.text}
        </p>
      )}

      {history.kind === "loading" && <p className="text-xs text-[var(--fg-muted)]">Loading history…</p>}
      {history.kind === "failed" && (
        <p role="alert" className="text-xs text-[var(--status-danger,#ef4444)]">
          {history.message}
        </p>
      )}
      {history.kind === "loaded" && (
        <ol className="flex flex-col gap-2">
          {history.versions.map((version, i) => (
            <li
              key={version.id}
              className="rounded-lg border border-[var(--line)] bg-[var(--surface-0)] p-3 flex flex-col gap-1.5"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-xs font-medium text-[var(--fg-primary)]">
                  Version {history.versions.length - i}
                  {version.current && (
                    <span className="ml-2 rounded-full bg-[var(--surface-3)] px-2 py-0.5 text-[10px] font-medium text-[var(--fg-secondary)]">
                      Current
                    </span>
                  )}
                  <span className="ml-2 font-normal text-[var(--fg-muted)]">
                    {new Date(version.createdAt).toLocaleString(undefined, {
                      month: "short",
                      day: "numeric",
                      hour: "numeric",
                      minute: "2-digit",
                    })}
                  </span>
                </p>
                {history.canRestore && !version.current && (
                  <button
                    onClick={() => void restore(version.id)}
                    disabled={busy !== null}
                    className="text-xs font-semibold text-[var(--gold-400)] hover:underline disabled:opacity-50"
                  >
                    {busy === "restoring" ? "Restoring…" : "Restore this version"}
                  </button>
                )}
              </div>
              {version.correction && (
                <p className="text-xs text-[var(--fg-secondary)]">
                  <span className="font-medium">Correction:</span> {version.correction}
                </p>
              )}
              {version.restoredFrom && (
                <p className="text-xs text-[var(--fg-muted)]">Restored from an earlier version.</p>
              )}
              {version.summary ? (
                <p className="text-xs text-[var(--fg-muted)] line-clamp-3">{version.summary}</p>
              ) : (
                <p className="text-xs italic text-[var(--fg-muted)]">No summary in this version.</p>
              )}
              {version.followUp && (
                <details>
                  <summary className="cursor-pointer text-xs text-[var(--fg-muted)] hover:text-[var(--fg-secondary)]">
                    Follow-up in this version
                  </summary>
                  <pre className="mt-1.5 whitespace-pre-wrap font-sans text-xs leading-relaxed text-[var(--fg-primary)]">
                    {version.followUp}
                  </pre>
                </details>
              )}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
