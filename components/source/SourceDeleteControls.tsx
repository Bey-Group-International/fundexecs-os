"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  deleteInvestorAction,
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

// ── LP Pipeline ──────────────────────────────────────────────────────────────

export function DeleteInvestorBtn({ id }: { id: string }) {
  const [pending, start] = useTransition();
  const router = useRouter();
  function handle() {
    if (!confirm("Remove this allocator from the directory?")) return;
    start(async () => {
      await deleteInvestorAction(id);
      router.refresh();
    });
  }
  return <DangerBtn onClick={handle} disabled={pending}>Remove</DangerBtn>;
}

export function ClearInvestorsBtn() {
  const [pending, start] = useTransition();
  const router = useRouter();
  function handle() {
    if (!confirm("Clear all allocators from the directory? This cannot be undone.")) return;
    start(async () => {
      await clearInvestorsAction();
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
      await deleteDealAction(id);
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
      await clearDealsAction();
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
      await deletePartnerAction(id);
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
      await clearPartnersAction();
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
      await deleteProviderAction(id);
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
      await clearProvidersAction();
      router.refresh();
    });
  }
  return <DangerBtn onClick={handle} disabled={pending}>Clear all</DangerBtn>;
}
