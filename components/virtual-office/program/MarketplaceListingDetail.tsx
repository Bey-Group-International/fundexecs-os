"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { prettyListingType, formatListingAmount } from "@/lib/office/listingFormat";
import { FloorOverlay } from "./FloorOverlay";

const TEAL = "#2dd4bf";

type Detail = {
  id: string;
  title: string;
  listing_type: string;
  summary: string | null;
  amount: number | null;
  status: string;
  target_irr: number | null;
  hold_period_years: number | null;
  geography: string | null;
  asset_class: string | null;
  teaser_url: string | null;
  organization_id: string;
  organizations: { name: string } | { name: string }[] | null;
};

function orgName(d: Detail): string | null {
  const o = d.organizations;
  if (!o) return null;
  return Array.isArray(o) ? o[0]?.name ?? null : o.name ?? null;
}

/**
 * In-world listing detail card. Opened from a market-stall press-X or a row in
 * the browse panel — shows a public listing's full detail without leaving the
 * floor, and records interest through the office's own API. "Open full page"
 * still deep-links to the full /marketplace surface.
 */
export function MarketplaceListingDetail({
  listingId,
  onClose,
  onOpenDealRoom,
}: {
  listingId: string;
  onClose: () => void;
  /** Convene a deal room around this listing (teleports to the Deal Room). */
  onOpenDealRoom?: (id: string) => void;
}) {
  const [detail, setDetail] = useState<Detail | null | "error">(null);
  const [interest, setInterest] = useState<"idle" | "pending" | "done" | "error">("idle");
  const [interestMsg, setInterestMsg] = useState<string>("");

  useEffect(() => {
    let cancelled = false;
    setDetail(null);
    setInterest("idle");
    setInterestMsg("");
    (async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("marketplace_listings")
        .select(
          "id, title, listing_type, summary, amount, status, target_irr, hold_period_years, geography, asset_class, teaser_url, organization_id, organizations(name)",
        )
        .eq("id", listingId)
        .eq("is_public", true)
        .maybeSingle();
      if (cancelled) return;
      setDetail(error || !data ? "error" : (data as unknown as Detail));
    })();
    return () => {
      cancelled = true;
    };
  }, [listingId]);

  const expressInterest = async () => {
    if (detail === null || detail === "error" || interest === "pending" || interest === "done") return;
    setInterest("pending");
    try {
      const res = await fetch("/api/marketplace/interest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ listingId: detail.id, listingTitle: detail.title }),
      });
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setInterest("error");
        setInterestMsg(json.error ?? "Couldn't record interest.");
      } else {
        setInterest("done");
        setInterestMsg("Interest sent — the owner has been notified.");
      }
    } catch {
      setInterest("error");
      setInterestMsg("Network error — try again.");
    }
  };

  if (detail === null) {
    return (
      <FloorOverlay accent={TEAL} onClose={onClose} ariaLabel="Listing detail">
        <p className="py-6 text-center text-[11px] text-slate-500">Loading listing…</p>
      </FloorOverlay>
    );
  }
  if (detail === "error") {
    return (
      <FloorOverlay accent={TEAL} onClose={onClose} ariaLabel="Listing detail">
        <p className="py-6 text-center text-[11px] text-slate-400">This listing isn&apos;t available.</p>
      </FloorOverlay>
    );
  }

  const stats: Array<{ label: string; value: string }> = [];
  const amt = formatListingAmount(detail.amount);
  if (amt) stats.push({ label: "Amount", value: amt });
  if (detail.target_irr != null) stats.push({ label: "Target IRR", value: `${detail.target_irr.toFixed(1)}%` });
  if (detail.hold_period_years != null) stats.push({ label: "Hold period", value: `${detail.hold_period_years}y` });
  if (detail.geography) stats.push({ label: "Geography", value: detail.geography });
  if (detail.asset_class) stats.push({ label: "Asset class", value: detail.asset_class });

  const org = orgName(detail);

  return (
    <FloorOverlay
      accent={TEAL}
      onClose={onClose}
      ariaLabel="Listing detail"
      eyebrow={
        <span className="rounded-sm px-1.5 py-0.5 text-[8px] uppercase tracking-wider" style={{ background: `${TEAL}24`, color: TEAL }}>
          {prettyListingType(detail.listing_type)}
        </span>
      }
      title={detail.title}
      subtitle={org ? `by ${org}` : undefined}
      footer={
        <div className="space-y-1.5">
          {/* Convene a deal room around this listing — a private working room
              the counterparty can be invited into, carrying this context. */}
          {onOpenDealRoom && (
            <button
              type="button"
              onClick={() => onOpenDealRoom(detail.id)}
              className="w-full rounded px-2 py-1.5 text-[10px] font-semibold uppercase tracking-wider transition-opacity"
              style={{ background: "#c9a84c", color: "#0a0806", fontFamily: "Georgia, serif" }}
            >
              Open a deal room →
            </button>
          )}
          <div className="flex gap-1.5">
            <button
              type="button"
              onClick={expressInterest}
              disabled={interest === "pending" || interest === "done"}
              className="flex-1 rounded px-2 py-1.5 text-[10px] font-semibold uppercase tracking-wider transition-opacity disabled:opacity-50"
              style={{ background: TEAL, color: "#0a0806", fontFamily: "Georgia, serif" }}
            >
              {interest === "pending" ? "Sending…" : interest === "done" ? "Interest sent ✓" : "Express interest"}
            </button>
            <a
              href={`/marketplace/${detail.id}`}
              className="rounded border px-2.5 py-1.5 text-[10px] uppercase tracking-wider text-slate-300 transition-colors hover:text-slate-100"
              style={{ borderColor: "rgba(255,255,255,0.15)" }}
            >
              Full page ↗
            </a>
          </div>
        </div>
      }
    >
      {detail.summary && <p className="text-[12px] leading-relaxed text-slate-300">{detail.summary}</p>}

      {stats.length > 0 && (
        <div className="grid grid-cols-2 gap-2">
          {stats.map((s) => (
            <div key={s.label} className="rounded-md border px-2.5 py-1.5" style={{ borderColor: "rgba(255,255,255,0.08)", background: "rgba(255,255,255,0.02)" }}>
              <div className="text-[8px] uppercase tracking-[0.16em] text-slate-500">{s.label}</div>
              <div className="mt-0.5 text-[12px] font-medium" style={{ color: TEAL }}>{s.value}</div>
            </div>
          ))}
        </div>
      )}

      {detail.teaser_url && (
        <a
          href={detail.teaser_url}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-block text-[10px] text-teal-300 underline underline-offset-2 hover:text-teal-200"
        >
          View teaser ↗
        </a>
      )}

      {interest !== "idle" && interest !== "pending" && (
        <p className="text-[10px]" style={{ color: interest === "done" ? "#22c55e" : "#ef4444" }}>
          {interestMsg}
        </p>
      )}
    </FloorOverlay>
  );
}
