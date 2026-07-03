"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  deleteWorkflow,
  clearWorkflows,
  deleteDeal,
  clearDeals,
  deleteArtifact,
  clearArtifacts,
} from "./actions";
import { TypedConfirmDialog } from "@/components/shared/TypedConfirmDialog";

// Shared tiny button used for both Delete (per-row) and Clear (section-level).
function ActionBtn({
  onClick,
  children,
  danger,
  pending,
}: {
  onClick: () => void;
  children: React.ReactNode;
  danger?: boolean;
  pending?: boolean;
}) {
  return (
    <button
      type="button"
      disabled={pending}
      onClick={onClick}
      className={`rounded-md border px-1.5 py-0.5 font-mono text-[10px] transition disabled:opacity-40 ${
        danger
          ? "border-status-danger/40 text-status-danger hover:bg-status-danger/10"
          : "border-line text-fg-muted hover:border-line hover:bg-surface-2 hover:text-fg-secondary"
      }`}
    >
      {pending ? "…" : children}
    </button>
  );
}

// Per-row workflow delete button.
export function DeleteWorkflowBtn({ id }: { id: string }) {
  const [pending, start] = useTransition();
  const router = useRouter();
  return (
    <ActionBtn
      danger
      pending={pending}
      onClick={() => {
        if (!confirm("Delete this workflow permanently?")) return;
        start(async () => {
          await deleteWorkflow(id);
          router.refresh();
        });
      }}
    >
      Delete
    </ActionBtn>
  );
}

// Section-level clear for all workflows.
export function ClearWorkflowsBtn() {
  const [pending, start] = useTransition();
  const router = useRouter();
  return (
    <ActionBtn
      danger
      pending={pending}
      onClick={() => {
        if (!confirm("Clear all workflows? This cannot be undone.")) return;
        start(async () => {
          await clearWorkflows();
          router.refresh();
        });
      }}
    >
      Clear all
    </ActionBtn>
  );
}

// Per-row deal delete button.
export function DeleteDealBtn({ id }: { id: string }) {
  const [pending, start] = useTransition();
  const router = useRouter();
  return (
    <ActionBtn
      danger
      pending={pending}
      onClick={() => {
        if (!confirm("Delete this deal permanently?")) return;
        start(async () => {
          await deleteDeal(id);
          router.refresh();
        });
      }}
    >
      Delete
    </ActionBtn>
  );
}

// Section-level clear for all deals. Archiving the entire pipeline for the
// org in one click is still a big enough blast radius (and there's no UI
// "undo") that a single dismissible confirm() isn't enough friction — this
// asks the operator to type a phrase instead.
export function ClearDealsBtn() {
  const [pending, start] = useTransition();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const router = useRouter();
  return (
    <>
      <ActionBtn danger pending={pending} onClick={() => setConfirmOpen(true)}>
        Clear all
      </ActionBtn>
      <TypedConfirmDialog
        open={confirmOpen}
        title="Clear all deals"
        body="This archives every deal in the pipeline for this org, hiding them from the active list. Documents, underwriting models, and diligence items are unaffected."
        phrase="CLEAR DEALS"
        confirmLabel="Clear all deals"
        onCancel={() => setConfirmOpen(false)}
        onConfirm={() => {
          setConfirmOpen(false);
          start(async () => {
            await clearDeals();
            router.refresh();
          });
        }}
      />
    </>
  );
}

// Per-row artifact delete button.
export function DeleteArtifactBtn({ id }: { id: string }) {
  const [pending, start] = useTransition();
  const router = useRouter();
  return (
    <ActionBtn
      danger
      pending={pending}
      onClick={() => {
        if (!confirm("Delete this deliverable permanently?")) return;
        start(async () => {
          await deleteArtifact(id);
          router.refresh();
        });
      }}
    >
      Delete
    </ActionBtn>
  );
}

// Section-level clear for all artifacts.
export function ClearArtifactsBtn() {
  const [pending, start] = useTransition();
  const router = useRouter();
  return (
    <ActionBtn
      danger
      pending={pending}
      onClick={() => {
        if (!confirm("Clear all deliverables? This cannot be undone.")) return;
        start(async () => {
          await clearArtifacts();
          router.refresh();
        });
      }}
    >
      Clear all
    </ActionBtn>
  );
}
