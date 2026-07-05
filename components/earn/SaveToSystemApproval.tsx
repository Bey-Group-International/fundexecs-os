"use client";

// SaveToSystemApproval — the explicit save gate. Reviewed-and-approved data is
// only written into the system when the operator presses this. It also carries
// the SEPARATE reminder that any external action (sending, submitting,
// purchasing, granting access) needs its own approval — save approval never
// grants outward action.

type Props = {
  /** Number of fields the operator approved in review. */
  approvedFieldCount: number;
  /** Where the data will be saved, e.g. "your professional network". */
  destinationLabel?: string;
  pending?: boolean;
  onConfirmSave: () => void;
  onCancel: () => void;
};

export function SaveToSystemApproval({
  approvedFieldCount,
  destinationLabel = "your system of record",
  pending,
  onConfirmSave,
  onCancel,
}: Props) {
  const canSave = approvedFieldCount > 0 && !pending;

  return (
    <div className="rounded-2xl border border-accent/40 bg-surface-1 p-5">
      <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-accent">
        Save approval
      </p>
      <h3 className="mt-1 text-base font-semibold text-fg">
        Save {approvedFieldCount} approved field{approvedFieldCount === 1 ? "" : "s"} to{" "}
        {destinationLabel}
      </h3>
      <p className="mt-2 text-sm text-fg-muted">
        Nothing is written until you approve it here. Only the fields you approved
        in review will be saved.
      </p>

      <div className="mt-4 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={onConfirmSave}
          disabled={!canSave}
          className="rounded-md border border-accent/60 bg-accent/10 px-3 py-2 text-sm font-medium text-accent transition hover:bg-accent/20 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {pending ? "Saving…" : "Approve and save"}
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={pending}
          className="rounded-md border border-line px-3 py-2 text-sm text-fg-muted transition hover:text-fg disabled:opacity-50"
        >
          Discard
        </button>
      </div>

      <div className="mt-4 rounded-md border border-line bg-surface-2 px-3 py-2">
        <p className="text-[11px] text-fg-muted">
          <span className="font-semibold text-fg">External actions are separate.</span>{" "}
          Saving data here does not let Earn send messages, submit forms, make
          purchases, or grant data-room access. Each of those requires its own
          explicit approval.
        </p>
      </div>
    </div>
  );
}
