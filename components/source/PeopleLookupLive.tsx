"use client";
// components/source/PeopleLookupLive.tsx
// Live people search powered by Apollo.io. Replaces the demo placeholder
// in the People Lookups module with real, verified contact data.

import { useState } from "react";
import { liveSearchPeople, liveVerifyEmail } from "@/app/(app)/[hub]/[module]/live-intel-actions";
import { VerificationBadge } from "@/components/source/VerificationBadge";
import type { VerifiedResult, VerifiedPerson } from "@/lib/source-hub-types";

const SENIORITY_OPTIONS = [
  { value: "c_suite", label: "C-Suite" },
  { value: "vp", label: "VP" },
  { value: "director", label: "Director" },
  { value: "manager", label: "Manager" },
];

const DEPARTMENT_OPTIONS = [
  { value: "finance", label: "Finance" },
  { value: "investment", label: "Investments" },
  { value: "operations", label: "Operations" },
  { value: "legal", label: "Legal" },
  { value: "executive", label: "Executive" },
];

type Phase = "idle" | "searching" | "done" | "error";

function initials(name: string): string {
  return name
    .split(" ")
    .map((w) => w[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

function PersonCard({ person, onVerifyEmail }: { person: VerifiedPerson; onVerifyEmail?: (email: string) => void }) {
  return (
    <div className="flex items-start gap-3 p-4 rounded-xl border border-border-secondary bg-surface-secondary hover:bg-surface-tertiary transition-colors">
      {/* Avatar */}
      <div className="flex-shrink-0 w-9 h-9 rounded-full bg-brand/10 flex items-center justify-center text-brand text-sm font-semibold">
        {initials(person.name)}
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-start justify-between gap-2">
          <div>
            <p className="text-sm font-medium text-fg-primary truncate">{person.name}</p>
            {person.title && (
              <p className="text-xs text-fg-secondary">{person.title}</p>
            )}
            {person.company && (
              <p className="text-xs text-fg-muted">{person.company}</p>
            )}
          </div>

          {/* Confidence pill */}
          <span
            className={`flex-shrink-0 text-xs font-mono px-1.5 py-0.5 rounded ${
              person.confidence >= 0.8
                ? "bg-emerald-50 text-emerald-700"
                : person.confidence >= 0.5
                ? "bg-amber-50 text-amber-700"
                : "bg-neutral-100 text-neutral-500"
            }`}
          >
            {Math.round(person.confidence * 100)}%
          </span>
        </div>

        {/* Contact details */}
        <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1">
          {person.email && (
            <button
              onClick={() => onVerifyEmail?.(person.email!)}
              className="flex items-center gap-1 text-xs text-brand hover:underline"
            >
              <span>✉</span>
              {person.email}
            </button>
          )}
          {person.linkedin_url && (
            <a
              href={person.linkedin_url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-fg-muted hover:text-fg-secondary"
            >
              LinkedIn ↗
            </a>
          )}
          {person.location && (
            <span className="text-xs text-fg-muted">{person.location}</span>
          )}
        </div>

        {/* Departments / seniority */}
        {(person.seniority || person.departments?.length) && (
          <div className="mt-1.5 flex flex-wrap gap-1">
            {person.seniority && (
              <span className="text-xs bg-surface-tertiary text-fg-muted px-1.5 py-0.5 rounded capitalize">
                {person.seniority.replace(/_/g, " ")}
              </span>
            )}
            {person.departments?.map((d) => (
              <span key={d} className="text-xs bg-surface-tertiary text-fg-muted px-1.5 py-0.5 rounded capitalize">
                {d}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export function PeopleLookupLive() {
  const [name, setName] = useState("");
  const [company, setCompany] = useState("");
  const [title, setTitle] = useState("");
  const [seniority, setSeniority] = useState<string[]>([]);
  const [departments, setDepartments] = useState<string[]>([]);
  const [phase, setPhase] = useState<Phase>("idle");
  const [result, setResult] = useState<VerifiedResult<VerifiedPerson[]> | null>(null);
  const [emailStatus, setEmailStatus] = useState<Record<string, string>>({});

  const canSearch = name || company || title;

  async function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    if (!canSearch) return;
    setPhase("searching");
    setResult(null);

    try {
      const res = await liveSearchPeople({
        name: name || undefined,
        company: company || undefined,
        title: title ? [title] : undefined,
        person_seniority: seniority.length ? seniority : undefined,
        person_department: departments.length ? departments : undefined,
        per_page: 20,
      });
      setResult(res);
      setPhase("done");
    } catch {
      setPhase("error");
    }
  }

  async function handleVerifyEmail(email: string) {
    setEmailStatus((s) => ({ ...s, [email]: "checking…" }));
    try {
      const res = await liveVerifyEmail(email);
      setEmailStatus((s) => ({
        ...s,
        [email]: res.data.valid ? "✓ Valid" : `✗ ${res.data.status}`,
      }));
    } catch {
      setEmailStatus((s) => ({ ...s, [email]: "✗ Error" }));
    }
  }

  function toggleMulti(arr: string[], val: string, set: (v: string[]) => void) {
    set(arr.includes(val) ? arr.filter((x) => x !== val) : [...arr, val]);
  }

  return (
    <div className="space-y-5">
      {/* Search form */}
      <form onSubmit={handleSearch} className="space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div>
            <label className="block text-xs font-medium text-fg-secondary mb-1">Name</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. John Smith"
              className="w-full text-sm px-3 py-2 rounded-lg border border-border-secondary bg-surface-secondary text-fg-primary placeholder:text-fg-muted focus:outline-none focus:ring-1 focus:ring-brand"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-fg-secondary mb-1">Company</label>
            <input
              value={company}
              onChange={(e) => setCompany(e.target.value)}
              placeholder="e.g. Blackstone"
              className="w-full text-sm px-3 py-2 rounded-lg border border-border-secondary bg-surface-secondary text-fg-primary placeholder:text-fg-muted focus:outline-none focus:ring-1 focus:ring-brand"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-fg-secondary mb-1">Title</label>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Managing Director"
              className="w-full text-sm px-3 py-2 rounded-lg border border-border-secondary bg-surface-secondary text-fg-primary placeholder:text-fg-muted focus:outline-none focus:ring-1 focus:ring-brand"
            />
          </div>
        </div>

        {/* Filters */}
        <div className="flex flex-wrap gap-3">
          <div>
            <p className="text-xs text-fg-muted mb-1">Seniority</p>
            <div className="flex flex-wrap gap-1.5">
              {SENIORITY_OPTIONS.map((o) => (
                <button
                  key={o.value}
                  type="button"
                  onClick={() => toggleMulti(seniority, o.value, setSeniority)}
                  className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${
                    seniority.includes(o.value)
                      ? "bg-brand text-white border-brand"
                      : "border-border-secondary text-fg-secondary hover:border-brand/50"
                  }`}
                >
                  {o.label}
                </button>
              ))}
            </div>
          </div>
          <div>
            <p className="text-xs text-fg-muted mb-1">Department</p>
            <div className="flex flex-wrap gap-1.5">
              {DEPARTMENT_OPTIONS.map((o) => (
                <button
                  key={o.value}
                  type="button"
                  onClick={() => toggleMulti(departments, o.value, setDepartments)}
                  className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${
                    departments.includes(o.value)
                      ? "bg-brand text-white border-brand"
                      : "border-border-secondary text-fg-secondary hover:border-brand/50"
                  }`}
                >
                  {o.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        <button
          type="submit"
          disabled={!canSearch || phase === "searching"}
          className="px-4 py-2 rounded-lg bg-brand text-white text-sm font-medium disabled:opacity-40 hover:bg-brand/90 transition-colors"
        >
          {phase === "searching" ? "Searching…" : "Search People"}
        </button>
      </form>

      {/* Results */}
      {result && (
        <div className="space-y-3">
          {/* Verification header */}
          <div className="flex items-center justify-between">
            <p className="text-sm text-fg-secondary">
              {result.data.length} result{result.data.length !== 1 ? "s" : ""}
              {result.cache?.cache_hit && (
                <span className="ml-2 text-xs text-fg-muted">(cached)</span>
              )}
            </p>
            <VerificationBadge
              verified={result.verified}
              confidence={result.confidence}
              sources={result.sources}
              cache={result.cache}
            />
          </div>

          {result.errors?.length ? (
            <div className="rounded-lg bg-red-50 border border-red-200 p-3">
              <p className="text-sm text-red-700">{result.errors.join(", ")}</p>
              {result.errors.some((e) => e.includes("APOLLO_API_KEY")) && (
                <p className="text-xs text-red-500 mt-1">
                  Add <code className="font-mono">APOLLO_API_KEY</code> to your environment variables to enable live search.
                </p>
              )}
            </div>
          ) : result.data.length === 0 ? (
            <div className="rounded-xl border border-border-secondary bg-surface-secondary p-8 text-center">
              <p className="text-sm text-fg-muted">No people found matching your criteria.</p>
            </div>
          ) : (
            <div className="space-y-2">
              {result.data.map((person, i) => (
                <PersonCard
                  key={person.id ?? `${person.name}-${i}`}
                  person={person}
                  onVerifyEmail={handleVerifyEmail}
                />
              ))}
            </div>
          )}

          {/* Email status feedback */}
          {Object.keys(emailStatus).length > 0 && (
            <div className="rounded-lg bg-surface-secondary border border-border-secondary p-3 space-y-1">
              <p className="text-xs font-medium text-fg-secondary">Email Verification</p>
              {Object.entries(emailStatus).map(([email, status]) => (
                <p key={email} className="text-xs text-fg-muted">
                  <span className="font-mono">{email}</span> — {status}
                </p>
              ))}
            </div>
          )}
        </div>
      )}

      {phase === "error" && !result && (
        <div className="rounded-lg bg-red-50 border border-red-200 p-3">
          <p className="text-sm text-red-700">Search failed. Please try again.</p>
        </div>
      )}
    </div>
  );
}
