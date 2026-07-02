"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  deleteInvestorAction,
  archiveInvestorAction,
  clearInvestorsAction,
  deleteDealAction,
  clearDealsAction,
  deletePartnerAction,
  clearPartnersAction,
  clearProvidersAction,
  deleteProviderAction,
} from "@/app/(app)/[hub]/[module]/actions";

function DangerBtn({
  onClick,
  disabled,
  children,
}: {
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="rounded border border-line px-2 py-0.5 font-mono text-[9px] uppercase tracking-wider text-fg-muted transition hover:border-status-danger/40 hover:text-status-danger disabled:opacity-40"
    >
      {children}
    </button>
  );
}

function alertError(err: string | undefined) {
  if (err) alert(err);
}

// ── LP Pipeline ──────────────────────────────────────────────────────────────

export function DeleteInvestorBtn({ id }: { id: string }) {
  const [pending, start] = useTransition();
  const router = useRouter();
  function handle() {
    if (!confirm("Permanently delete this allocator? This cannot be undone.")) return;
    start(async () => {
      const result = await deleteInvestorAction(id);
      if (result?.error) { alertError(result.error); return; }
      router.refresh();
    });
  }
  return <DangerBtn onClick={handle} disabled={pending}>Delete</DangerBtn>;
}

export function ArchiveInvestorBtn({ id }: { id: string }) {
  const [pending, start] = useTransition();
  const router = useRouter();
  function handle() {
    if (!confirm("Archive this allocator? It will be hidden from the active list.")) return;
    start(async () => {
      const result = await archiveInvestorAction(id);
      if (result?.error) { alertError(result.error); return; }
      router.refresh();
    });
  }
  return <DangerBtn onClick={handle} disabled={pending}>Archive</DangerBtn>;
}

export function ClearInvestorsBtn() {
  const [pending, start] = useTransition();
  const router = useRouter();
  function handle() {
    if (!confirm("Permanently delete all allocators from the directory? This cannot be undone.")) return;
    start(async () => {
      const result = await clearInvestorsAction();
      if (result?.error) { alertError(result.error); return; }
      router.refresh();
    });
  }
  return <DangerBtn onClick={handle} disabled={pending}>Clear all</DangerBtn>;
}

// ── Deal Pipeline ────────────────────────────────────────────────────────────

export function DeleteDealBtn({ id, onDeleted }: { id: string; onDeleted?: (id: string) => void }) {
  const [pending, start] = useTransition();
  const router = useRouter();
  function handle() {
    if (!confirm("Remove this deal from the pipeline?")) return;
    start(async () => {
      const result = await deleteDealAction(id);
      if (result?.error) { alertError(result.error); return; }
      onDeleted?.(id);
      router.refresh();
    });
  }
  return <DangerBtn onClick={handle} disabled={pending}>Remove</DangerBtn>;
}

export function ClearDealsBtn() {
  const [pending, start] = useTransition();
  const router = useRouter();
  function handle() {
    if (!confirm("Clear the entire deal pipeline? This cannot be undone.")) return;
    start(async () => {
      const result = await clearDealsAction();
      if (result?.error) { alertError(result.error); return; }
      router.refresh();
    });
  }
  return <DangerBtn onClick={handle} disabled={pending}>Clear all</DangerBtn>;
}

// ── Partners ─────────────────────────────────────────────────────────────────

export function DeletePartnerBtn({ id }: { id: string }) {
  const [pending, start] = useTransition();
  const router = useRouter();
  function handle() {
    if (!confirm("Remove this partner?")) return;
    start(async () => {
      const result = await deletePartnerAction(id);
      if (result?.error) { alertError(result.error); return; }
      router.refresh();
    });
  }
  return <DangerBtn onClick={handle} disabled={pending}>Remove</DangerBtn>;
}

export function ClearPartnersBtn() {
  const [pending, start] = useTransition();
  const router = useRouter();
  function handle() {
    if (!confirm("Clear all partners? This cannot be undone.")) return;
    start(async () => {
      const result = await clearPartnersAction();
      if (result?.error) { alertError(result.error); return; }
      router.refresh();
    });
  }
  return <DangerBtn onClick={handle} disabled={pending}>Clear all</DangerBtn>;
}

// ── Service Providers ────────────────────────────────────────────────────────

export function DeleteProviderBtn({ id }: { id: string }) {
  const [pending, start] = useTransition();
  const router = useRouter();
  function handle() {
    if (!confirm("Remove this provider?")) return;
    start(async () => {
      const result = await deleteProviderAction(id);
      if (result?.error) { alertError(result.error); return; }
      router.refresh();
    });
  }
  return <DangerBtn onClick={handle} disabled={pending}>Remove</DangerBtn>;
}

export function ClearProvidersBtn() {
  const [pending, start] = useTransition();
  const router = useRouter();
  function handle() {
    if (!confirm("Clear all service providers? This cannot be undone.")) return;
    start(async () => {
      const result = await clearProvidersAction();
      if (result?.error) { alertError(result.error); return; }
      router.refresh();
    });
  }
  return <DangerBtn onClick={handle} disabled={pending}>Clear all</DangerBtn>;
}
