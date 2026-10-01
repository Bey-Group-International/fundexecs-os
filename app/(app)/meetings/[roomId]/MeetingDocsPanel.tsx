"use client";
// app/(app)/meetings/[roomId]/MeetingDocsPanel.tsx
// The in-call data-room picker.
//
// One tab, one list, one tap. The tap mints a link to the document and
// announces it in the chat, which is where every participant -- including the
// guest with no account, who is usually the person being shared with -- can
// already see it.
//
// Its own file rather than another 150 lines inside CallParts.tsx, and it
// fetches its own data rather than taking it as props, for the same reason the
// invite box in the People tab does: a call where nobody opens this tab should
// pay nothing for it. The load happens on first open, not on mount.
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  DOC_SHARE_EXPIRY_DAYS,
  blockedLabel,
  docShareChatText,
  groupMeetingDocs,
  searchMeetingDocs,
  sharedUrlFor,
  type MeetingDoc,
} from "@/lib/meetings/doc-share";

interface SharedDoc {
  documentId: string;
  url: string;
  sharedAt: string;
}

/** Everything the panel can be in the middle of. */
type Load =
  | { state: "idle" }
  | { state: "loading" }
  | { state: "ready" }
  | { state: "forbidden" }
  | { state: "error"; message: string };

export function MeetingDocsPanel({
  meetingId,
  onShare,
}: {
  /** Null before the room has resolved its meeting; the panel waits rather than guessing. */
  meetingId: string | null;
  /**
   * Announce the link in the room.
   *
   * The panel does not deliver anything itself. This is the room's ordinary
   * chat send, so the message is broadcast to live peers, stored, ordered by
   * the server's clock and carried into the report and the export -- none of
   * which a second delivery path would get for free.
   */
  onShare: (text: string) => void;
}) {
  const [load, setLoad] = useState<Load>({ state: "idle" });
  const [docs, setDocs] = useState<MeetingDoc[]>([]);
  const [shared, setShared] = useState<SharedDoc[]>([]);
  const [truncated, setTruncated] = useState(false);
  const [query, setQuery] = useState("");
  /** The document a tap is in flight for, so a slow mint cannot be tapped twice. */
  const [pending, setPending] = useState<string | null>(null);
  const [failed, setFailed] = useState<{ id: string; message: string } | null>(null);

  const refresh = useCallback(async () => {
    if (!meetingId) return;
    setLoad({ state: "loading" });
    try {
      const res = await fetch(`/api/meetings/${meetingId}/documents`, { cache: "no-store" });
      if (res.status === 401) {
        // A signed-in participant who is not a member of the host's firm. The
        // tab is offered to everyone signed in, because the room cannot tell
        // membership apart from attendance -- so the refusal is reported here
        // in words rather than left as an empty list.
        setLoad({ state: "forbidden" });
        return;
      }
      if (!res.ok) {
        setLoad({ state: "error", message: "Could not load the data room." });
        return;
      }
      const body = (await res.json()) as { docs?: MeetingDoc[]; shared?: SharedDoc[]; truncated?: boolean };
      setDocs(body.docs ?? []);
      setShared(body.shared ?? []);
      setTruncated(Boolean(body.truncated));
      setLoad({ state: "ready" });
    } catch {
      setLoad({ state: "error", message: "Could not reach the data room." });
    }
  }, [meetingId]);

  // On first open only. The effect depends on `load.state === "idle"` rather
  // than running unconditionally so that a re-render -- and in a live call
  // there are several a second -- does not re-fetch the firm's materials.
  useEffect(() => {
    if (load.state === "idle") void refresh();
  }, [load.state, refresh]);

  const visible = useMemo(() => searchMeetingDocs(docs, query), [docs, query]);
  const groups = useMemo(() => groupMeetingDocs(visible), [visible]);

  const share = async (doc: MeetingDoc) => {
    if (!meetingId || pending) return;

    // Already on the table: re-announce the link we have rather than asking the
    // server for it again. The server would hand back the same link -- the row
    // is keyed on (meeting, document) -- but a host re-sharing a document for
    // somebody who joined late should not wait on a round trip for it.
    const held = sharedUrlFor(shared, doc.id);
    if (held) {
      onShare(docShareChatText({ documentName: doc.name, url: held }));
      return;
    }

    setPending(doc.id);
    setFailed(null);
    try {
      const res = await fetch(`/api/meetings/${meetingId}/documents`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ documentId: doc.id }),
      });
      const body = (await res.json().catch(() => ({}))) as { url?: string; documentName?: string; error?: string };
      if (!res.ok || !body.url) {
        setFailed({ id: doc.id, message: body.error ?? "Could not share that document." });
        return;
      }
      setShared((prev) =>
        prev.some((s) => s.documentId === doc.id)
          ? prev
          : [...prev, { documentId: doc.id, url: body.url as string, sharedAt: new Date().toISOString() }],
      );
      onShare(docShareChatText({ documentName: body.documentName ?? doc.name, url: body.url }));
    } catch {
      setFailed({ id: doc.id, message: "Could not reach the data room." });
    } finally {
      setPending(null);
    }
  };

  if (!meetingId) {
    return <PanelNote>Waiting for the meeting to start.</PanelNote>;
  }

  if (load.state === "loading" || load.state === "idle") {
    return <PanelNote>Loading the data room…</PanelNote>;
  }

  if (load.state === "forbidden") {
    return (
      <PanelNote>
        You are in this call as a guest of the host&apos;s firm, so its data room is not yours to share from.
      </PanelNote>
    );
  }

  if (load.state === "error") {
    return (
      <div className="flex flex-col gap-2">
        <PanelNote>{load.message}</PanelNote>
        <button
          onClick={() => void refresh()}
          className="self-start rounded-lg border border-[var(--line)] bg-[var(--surface-2)] px-2.5 py-1.5 text-xs text-[var(--fg-secondary)] transition-colors hover:text-[var(--fg-primary)]"
        >
          Try again
        </button>
      </div>
    );
  }

  if (docs.length === 0) {
    return (
      <PanelNote>
        Nothing is published to a data room yet. Publish a document under Build → Materials and it will appear here.
      </PanelNote>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search documents, sections, rooms"
        aria-label="Search the data room"
        className="rounded-lg border border-[var(--line)] bg-[var(--surface-2)] px-2 py-1.5 text-xs text-[var(--fg-primary)] placeholder:text-[var(--fg-muted)] focus:outline-none focus:ring-1 focus:ring-[var(--gold-400)]"
      />

      {/* Said once, at the top, rather than per row: the host is handing out a
          link that outlives the call, and that is worth knowing before the
          first tap rather than discovering in the Shares list afterwards. */}
      <p className="px-1 text-[11px] leading-snug text-[var(--fg-muted)]">
        Sharing posts a link in the chat. It expires in {DOC_SHARE_EXPIRY_DAYS} days, asks the reader for their
        email, and is watermarked.
      </p>

      {visible.length === 0 && <PanelNote>Nothing matches “{query}”.</PanelNote>}

      {groups.map((group) => (
        <div key={group.key} className="flex flex-col gap-1">
          <p className="px-1 text-xs font-medium uppercase tracking-wide text-[var(--fg-secondary)]">
            {group.label}
          </p>
          {group.docs.map((doc) => (
            <DocRow
              key={doc.id}
              doc={doc}
              sharedUrl={sharedUrlFor(shared, doc.id)}
              pending={pending === doc.id}
              disabled={pending !== null && pending !== doc.id}
              error={failed?.id === doc.id ? failed.message : null}
              onShare={() => void share(doc)}
            />
          ))}
        </div>
      ))}

      {truncated && (
        // The bound is stated rather than hidden. A host who cannot find a
        // document needs to tell "not published" from "not loaded", and a list
        // that silently stops makes those identical.
        <p className="px-1 text-[11px] leading-snug text-[var(--fg-muted)]">
          Only the first {docs.length} published documents are listed. Search narrows what is loaded here, not the
          data room itself — share the room from Build → Materials if what you need is missing.
        </p>
      )}
    </div>
  );
}

function DocRow({
  doc, sharedUrl, pending, disabled, error, onShare,
}: {
  doc: MeetingDoc;
  sharedUrl: string | null;
  pending: boolean;
  disabled: boolean;
  error: string | null;
  onShare: () => void;
}) {
  return (
    <div className="flex flex-col gap-1 rounded-lg px-2 py-1.5 hover:bg-[var(--surface-2)]">
      <div className="flex items-center gap-2">
        <span className="min-w-0 flex-1 truncate text-sm text-[var(--fg-primary)]" title={doc.name}>
          {doc.name}
        </span>
        {doc.blocked ? (
          <span className="shrink-0 text-[11px] text-[var(--fg-muted)]">{blockedLabel(doc.blocked)}</span>
        ) : (
          <button
            onClick={onShare}
            disabled={pending || disabled}
            className="shrink-0 rounded-lg border border-[var(--line)] bg-[var(--surface-2)] px-2 py-1 text-xs font-medium text-[var(--fg-secondary)] transition-colors hover:text-[var(--fg-primary)] disabled:opacity-40"
          >
            {pending ? "…" : sharedUrl ? "Send again" : "Share"}
          </button>
        )}
      </div>
      <div className="flex items-center gap-1.5">
        <span className="truncate text-[11px] text-[var(--fg-muted)]">{doc.roomName}</span>
        {sharedUrl && !doc.blocked && (
          <span className="shrink-0 text-[11px] text-[var(--status-success)]">Shared</span>
        )}
      </div>
      {error && <p className="text-[11px] leading-snug text-[var(--status-danger)]">{error}</p>}
    </div>
  );
}

function PanelNote({ children }: { children: React.ReactNode }) {
  return <p className="px-1 py-2 text-xs leading-snug text-[var(--fg-muted)]">{children}</p>;
}
