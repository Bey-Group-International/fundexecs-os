import type { ReactNode } from "react";
import {
  daysWaiting,
  groupSignatureTasks,
  signatureSummary,
  waitingLabel,
  type SignatureTask,
} from "@/lib/data-room-signatures";

/**
 * The list of files waiting on the fund's signature, grouped by room. Plain
 * presentation: who may sign and what the action buttons are come from the caller.
 */
export function SignaturesList({
  tasks,
  error,
  currentRoomId,
  canSign,
  legacyAction,
  envelopeAction,
  now,
}: {
  tasks: SignatureTask[];
  /** Set when the list could not be loaded: shown instead of the list, never as "nothing". */
  error?: string | null;
  currentRoomId: string;
  canSign: boolean;
  legacyAction: (t: SignatureTask) => ReactNode;
  envelopeAction: (t: SignatureTask) => ReactNode;
  now?: Date;
}) {
  const groups = groupSignatureTasks(tasks);
  // The room being viewed first; the rest keep their order.
  groups.sort((a, b) => Number(b.roomId === currentRoomId) - Number(a.roomId === currentRoomId));

  if (error) {
    return (
      <section aria-label="Documents awaiting your signature" data-testid="signatures-awaiting">
        <h3 className="font-display text-lg font-semibold tracking-tight text-fg-primary">Needs your signature</h3>
        <p role="alert" className="mt-2 rounded-xl border border-status-danger/40 bg-status-danger/5 px-4 py-3 text-sm text-status-danger">
          Couldn&apos;t load the documents waiting for your signature, so this list may be incomplete. Reload the page to try again.
        </p>
      </section>
    );
  }

  return (
    <section aria-label="Documents awaiting your signature" data-testid="signatures-awaiting">
      <div className="mb-3">
        <h3 className="font-display text-lg font-semibold tracking-tight text-fg-primary">Needs your signature</h3>
        <p className="mt-0.5 text-xs text-fg-muted" data-testid="signatures-summary">
          {signatureSummary(tasks.length)}
          {tasks.length > 0 ? " Across all your data rooms." : ""}
        </p>
        {tasks.length > 0 && !canSign ? (
          <p className="mt-1 text-xs text-amber-400">
            Only an owner or admin with a confirmed email can counter-sign. Ask one of them to open this tab.
          </p>
        ) : null}
      </div>

      {tasks.length === 0 ? (
        <div className="rounded-xl border border-dashed border-line bg-surface-0 px-4 py-8 text-center">
          <p className="text-sm text-fg-secondary">Nothing is waiting for your signature.</p>
          <p className="mt-1 text-xs text-fg-muted">
            Files readers have signed that need the fund&apos;s counter-signature appear here.
          </p>
        </div>
      ) : (
        <div className="space-y-5">
          {groups.map((g) => (
            <div key={g.roomId}>
              <h4 className="mb-2 flex flex-wrap items-baseline gap-2 text-sm font-medium text-fg-primary">
                {g.roomName}
                {g.roomId === currentRoomId ? <span className="text-xs font-normal text-fg-muted">this room</span> : null}
                <span className="text-xs font-normal text-fg-muted">· {g.tasks.length}</span>
              </h4>
              <ul className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-surface-1">
                {g.tasks.map((t) => {
                  const wait = waitingLabel(daysWaiting(t.signedAt, now));
                  return (
                    <li key={t.key} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
                      <div className="min-w-0 flex-1 basis-60">
                        <p className="truncate text-sm font-medium text-fg-primary" title={t.title}>
                          {t.title}
                        </p>
                        <p className="truncate text-xs text-fg-muted">
                          {t.signerName ? `Signed by ${t.signerName}` : "Signed by the reader"}
                          {wait ? ` · ${wait}` : ""}
                        </p>
                      </div>
                      {canSign ? <div className="shrink-0">{t.kind === "envelope" ? envelopeAction(t) : legacyAction(t)}</div> : null}
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
