"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { promoteDealToAsset } from "@/components/execute/actions";
import { useToast } from "@/components/shared/CoachingToast";

// Execute › Closing: promotes a closed deal into a portfolio holding. A
// client wrapper around the promoteDealToAsset server action so a failed
// promotion (RPC error, deal no longer found) surfaces to the operator
// instead of the button silently doing nothing.
export function PromoteDealButton({ dealId, ready }: { dealId: string; ready: boolean }) {
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const toast = useToast();
  const router = useRouter();

  const onClick = () => {
    setError(null);
    const formData = new FormData();
    formData.set("deal_id", dealId);
    start(async () => {
      const result = await promoteDealToAsset(formData);
      if (!result.ok) {
        const message = result.error ?? "Could not promote this deal.";
        setError(message);
        toast.error("Promotion failed", message);
        return;
      }
      toast.success("Deal promoted to portfolio");
      router.refresh();
    });
  };

  return (
    <span className="flex shrink-0 flex-col items-end gap-1">
      {error ? <span className="text-[11px] text-status-danger">{error}</span> : null}
      <button
        type="button"
        disabled={pending}
        onClick={onClick}
        className={`inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-medium transition disabled:cursor-not-allowed disabled:opacity-50 ${
          ready
            ? "border-emerald-400/50 bg-emerald-400/10 text-emerald-300 hover:bg-emerald-400/20"
            : "border-gold-500/40 bg-gold-500/10 text-gold-300 hover:bg-gold-500/20"
        }`}
      >
        {pending ? "Promoting…" : `→ ${ready ? "Complete close" : "Promote to portfolio"}`}
      </button>
    </span>
  );
}
