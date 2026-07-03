"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  verifyRecord,
  unverifyRecord,
  archiveRecord,
  restoreRecord,
  deleteRecord,
} from "@/app/(app)/[hub]/[module]/record-actions";
import type { RecordActionResult } from "@/lib/managed-tables";
import { useToast } from "@/components/shared/CoachingToast";

type VerifyState = "verified" | "unverified" | string | null | undefined;

const baseButton =
  "rounded-md border px-3 py-1.5 text-xs transition disabled:opacity-50";
const neutralButton = `${baseButton} border-line text-fg-secondary hover:bg-surface-3`;
const dangerButton = `${baseButton} border-status-danger/40 text-status-danger hover:bg-status-danger/10`;

export function RecordLifecycleActions({
  hub,
  module,
  table,
  id,
  archived = false,
  verificationStatus,
  showVerify = false,
  className = "",
  deleteClassName = "ml-auto",
}: {
  hub: string;
  module: string;
  table: string;
  id: string;
  archived?: boolean;
  verificationStatus?: VerifyState;
  showVerify?: boolean;
  className?: string;
  deleteClassName?: string;
}) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [noteOpen, setNoteOpen] = useState(false);
  const [noteText, setNoteText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();
  const toast = useToast();

  // `label` names the outcome in the toast ("Record verified"); the inline
  // error stays for context right next to the control that failed.
  const run = (fn: () => Promise<RecordActionResult>, label: string) => {
    setError(null);
    start(async () => {
      const res = await fn();
      if (!res.ok) {
        const message = res.error ?? "Action failed.";
        setError(message);
        toast.error(`${label} failed`, message);
      } else {
        toast.success(label);
        router.refresh();
      }
    });
  };

  return (
    <div className={`flex flex-wrap items-center gap-2 ${className}`}>
      {error ? <span className="text-xs text-status-danger">{error}</span> : null}
      {archived ? (
        <button
          type="button"
          disabled={pending}
          onClick={() => run(() => restoreRecord(hub, module, table, id), "Record restored")}
          className={neutralButton}
        >
          Restore
        </button>
      ) : (
        <>
          {showVerify ? (
            verificationStatus === "verified" ? (
              <button
                type="button"
                disabled={pending}
                onClick={() => run(() => unverifyRecord(hub, module, table, id), "Verification removed")}
                className={neutralButton}
              >
                Unverify
              </button>
            ) : noteOpen ? (
              <span className="flex items-center gap-1.5">
                <input
                  autoFocus
                  value={noteText}
                  onChange={(e) => setNoteText(e.target.value)}
                  placeholder="Evidence URL or note (optional)"
                  className="w-56 rounded-md border border-line bg-surface-0 px-2.5 py-1.5 text-xs text-fg-primary outline-none focus:border-gold-500"
                />
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => {
                    run(() => verifyRecord(hub, module, table, id, noteText), "Record verified");
                    setNoteOpen(false);
                    setNoteText("");
                  }}
                  className="rounded-md bg-status-success/90 px-3 py-1.5 text-xs font-medium text-surface-0 transition hover:bg-status-success disabled:opacity-50"
                >
                  Confirm verify
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setNoteOpen(false);
                    setNoteText("");
                  }}
                  className="text-xs text-fg-muted hover:text-fg-secondary"
                >
                  Cancel
                </button>
              </span>
            ) : (
              <button
                type="button"
                disabled={pending}
                onClick={() => {
                  setNoteOpen(true);
                  setNoteText("");
                }}
                className={`${baseButton} border-status-success/40 bg-status-success/10 font-medium text-status-success hover:bg-status-success/20`}
              >
                ✓ Verify
              </button>
            )
          ) : null}
          <button
            type="button"
            disabled={pending}
            onClick={() => run(() => archiveRecord(hub, module, table, id), "Record archived")}
            className={neutralButton}
          >
            Archive
          </button>
        </>
      )}
      {confirmDelete ? (
        <span className={`flex items-center gap-1.5 ${deleteClassName}`}>
          <button
            type="button"
            disabled={pending}
            onClick={() => {
              run(() => deleteRecord(hub, module, table, id), "Record deleted");
              setConfirmDelete(false);
            }}
            className="rounded-md bg-status-danger/90 px-3 py-1.5 text-xs font-medium text-surface-0 transition hover:bg-status-danger disabled:opacity-50"
          >
            Confirm delete
          </button>
          <button
            type="button"
            onClick={() => setConfirmDelete(false)}
            className="text-xs text-fg-muted hover:text-fg-secondary"
          >
            Cancel
          </button>
        </span>
      ) : (
        <button
          type="button"
          disabled={pending}
          onClick={() => setConfirmDelete(true)}
          className={`${dangerButton} ${deleteClassName}`}
        >
          Delete
        </button>
      )}
    </div>
  );
}

export function RecordBulkLifecycleActions({
  hub,
  module,
  table,
  ids,
  onComplete,
}: {
  hub: string;
  module: string;
  table: string;
  ids: string[];
  onComplete?: () => void;
}) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();
  const toast = useToast();

  const runMany = (action: (id: string) => Promise<RecordActionResult>, label: string) => {
    setError(null);
    start(async () => {
      const results = await Promise.all(ids.map((id) => action(id)));
      const failedCount = results.filter((res) => !res.ok).length;
      if (failedCount > 0) {
        const failed = results.find((res) => !res.ok);
        const message = failed?.error ?? "Action failed.";
        setError(message);
        toast.error(
          `${label} failed for ${failedCount} of ${ids.length}`,
          message,
        );
        return;
      }
      toast.success(`${label} — ${ids.length} record${ids.length === 1 ? "" : "s"}`);
      onComplete?.();
      router.refresh();
    });
  };

  if (ids.length === 0) return null;

  return (
    <div className="flex items-center gap-1.5">
      {error ? <span className="text-xs text-status-danger">{error}</span> : null}
      <button
        type="button"
        disabled={pending}
        onClick={() => runMany((id) => archiveRecord(hub, module, table, id), "Archived")}
        className="rounded-md border border-line px-2 py-1 text-[11px] text-fg-secondary transition hover:bg-surface-3 disabled:opacity-50"
      >
        Archive
      </button>
      {confirmDelete ? (
        <>
          <button
            type="button"
            disabled={pending}
            onClick={() => {
              runMany((id) => deleteRecord(hub, module, table, id), "Deleted");
              setConfirmDelete(false);
            }}
            className="rounded-md bg-status-danger/90 px-2 py-1 text-[11px] font-medium text-surface-0 transition hover:bg-status-danger disabled:opacity-50"
          >
            Confirm delete
          </button>
          <button
            type="button"
            onClick={() => setConfirmDelete(false)}
            className="text-[11px] text-fg-muted hover:text-fg-secondary"
          >
            Cancel
          </button>
        </>
      ) : (
        <button
          type="button"
          disabled={pending}
          onClick={() => setConfirmDelete(true)}
          className="rounded-md border border-status-danger/40 px-2 py-1 text-[11px] text-status-danger transition hover:bg-status-danger/10 disabled:opacity-50"
        >
          Delete
        </button>
      )}
    </div>
  );
}
