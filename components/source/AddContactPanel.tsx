"use client";

// Primary per-contact add flow for the Capital Network: manual entry or a
// user-provided LinkedIn profile URL. Runs through the professional-network
// adapter pipeline server-side; on a high-confidence duplicate the API returns
// the matches and the user decides (merge intent → cancel, or force-add).

import { useState } from "react";
import { CAPITAL_ROLES, type CapitalRole } from "@/lib/integrations/professional-network/types";

type Duplicate = {
  contactId: string;
  fullName: string;
  company: string | null;
  matchedOn: string;
  matchConfidence: number;
};

type Mode = "linkedin_url" | "manual";

const ROLE_LABELS: Record<CapitalRole, string> = {
  fund_manager: "Fund Manager",
  limited_partner: "Limited Partner",
  independent_sponsor: "Independent Sponsor",
  capital_provider: "Capital Provider",
  family_office: "Family Office",
  operator: "Operator",
  founder: "Founder",
  broker: "Broker",
  lender: "Lender",
  advisor: "Advisor",
  strategic_partner: "Strategic Partner",
  service_provider: "Service Provider",
  unknown: "Unknown / classify later",
};

export function AddContactPanel({ onAdded }: { onAdded?: () => void }) {
  const [mode, setMode] = useState<Mode>("linkedin_url");
  const [fullName, setFullName] = useState("");
  const [linkedinUrl, setLinkedinUrl] = useState("");
  const [email, setEmail] = useState("");
  const [title, setTitle] = useState("");
  const [company, setCompany] = useState("");
  const [capitalRole, setCapitalRole] = useState<CapitalRole>("unknown");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [duplicates, setDuplicates] = useState<Duplicate[] | null>(null);
  const [success, setSuccess] = useState<{ fullName: string; confidence: number; source: string } | null>(null);

  const reset = () => {
    setFullName(""); setLinkedinUrl(""); setEmail(""); setTitle(""); setCompany("");
    setCapitalRole("unknown"); setDuplicates(null); setError(null);
  };

  async function submit(force = false) {
    setBusy(true);
    setError(null);
    if (!force) setDuplicates(null);
    setSuccess(null);
    try {
      const res = await fetch("/api/network/contacts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode,
          fullName: fullName || undefined,
          linkedinUrl: linkedinUrl || undefined,
          email: email || undefined,
          title: title || undefined,
          company: company || undefined,
          capitalRole,
          force,
        }),
      });
      const data = await res.json();
      if (res.status === 409 && data.needsReview) {
        setDuplicates(data.duplicates as Duplicate[]);
        return;
      }
      if (!res.ok) {
        setError(data.error ?? "Could not add contact.");
        return;
      }
      setSuccess(data.profile);
      reset();
      onAdded?.();
    } catch {
      setError("Network error — try again.");
    } finally {
      setBusy(false);
    }
  }

  const inputCls =
    "rounded-lg border border-line bg-transparent px-3 py-2 text-sm text-fg placeholder:text-fg-muted/60 outline-none focus:border-accent/60";

  return (
    <div className="rounded-xl border border-line bg-surface p-6 flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div>
          <p className="font-semibold text-fg">Add a professional contact</p>
          <p className="text-sm text-fg-muted">
            Paste a LinkedIn profile URL or enter details manually. Contacts normalize
            into your Capital Network with source attribution and confidence scoring.
          </p>
        </div>
      </div>

      {/* Mode toggle */}
      <div className="flex gap-1">
        {(["linkedin_url", "manual"] as Mode[]).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => { setMode(m); setDuplicates(null); setError(null); }}
            className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors border ${
              mode === m
                ? "border-accent/50 bg-accent/10 text-accent"
                : "border-line text-fg-muted hover:text-fg"
            }`}
          >
            {m === "linkedin_url" ? "LinkedIn profile URL" : "Manual entry"}
          </button>
        ))}
      </div>

      <form
        onSubmit={(e) => { e.preventDefault(); void submit(false); }}
        className="grid grid-cols-1 gap-3 sm:grid-cols-2"
      >
        {mode === "linkedin_url" && (
          <input
            type="url"
            required
            value={linkedinUrl}
            onChange={(e) => setLinkedinUrl(e.target.value)}
            placeholder="https://www.linkedin.com/in/…"
            className={`${inputCls} sm:col-span-2`}
          />
        )}
        <input
          type="text"
          required={mode === "manual"}
          value={fullName}
          onChange={(e) => setFullName(e.target.value)}
          placeholder={mode === "manual" ? "Full name" : "Full name (optional — inferred from URL)"}
          className={inputCls}
        />
        <select
          value={capitalRole}
          onChange={(e) => setCapitalRole(e.target.value as CapitalRole)}
          className={`${inputCls} bg-surface`}
        >
          {CAPITAL_ROLES.map((r) => (
            <option key={r} value={r}>{ROLE_LABELS[r]}</option>
          ))}
        </select>
        <input type="text" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Title (optional)" className={inputCls} />
        <input type="text" value={company} onChange={(e) => setCompany(e.target.value)} placeholder="Company (optional)" className={inputCls} />
        {mode === "manual" && (
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email (optional)" className={`${inputCls} sm:col-span-2`} />
        )}
        <div className="sm:col-span-2 flex items-center gap-3">
          <button
            type="submit"
            disabled={busy}
            className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-accent-contrast hover:opacity-90 transition-opacity disabled:opacity-50"
          >
            {busy ? "Adding…" : "Add to Capital Network"}
          </button>
          <p className="text-xs text-fg-muted">
            No scraping — the URL is stored as a reference with the details you provide.
          </p>
        </div>
      </form>

      {error && <p className="text-sm text-red-400">{error}</p>}

      {/* Duplicate review — user decides before anything is inserted */}
      {duplicates && (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-4 flex flex-col gap-2">
          <p className="text-sm font-medium text-amber-400">
            Possible duplicate{duplicates.length === 1 ? "" : "s"} found — review before adding:
          </p>
          {duplicates.slice(0, 3).map((d) => (
            <p key={d.contactId} className="text-sm text-fg-muted">
              <span className="text-fg">{d.fullName}</span>
              {d.company ? ` · ${d.company}` : ""} — matched on {d.matchedOn.replace(/_/g, " ")} ({d.matchConfidence}%)
            </p>
          ))}
          <div className="flex gap-2 pt-1">
            <button
              type="button"
              disabled={busy}
              onClick={() => void submit(true)}
              className="rounded-lg border border-amber-500/40 px-3 py-1.5 text-xs font-medium text-amber-400 hover:bg-amber-500/10"
            >
              Add anyway
            </button>
            <button
              type="button"
              onClick={() => setDuplicates(null)}
              className="rounded-lg border border-line px-3 py-1.5 text-xs text-fg-muted hover:text-fg"
            >
              Cancel — it&apos;s the same person
            </button>
          </div>
        </div>
      )}

      {success && (
        <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-400">
          Added {success.fullName} · source: {success.source.replace(/_/g, " ")} · confidence {success.confidence}%
        </div>
      )}
    </div>
  );
}
