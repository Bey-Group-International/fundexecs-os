"use client";

import { useState } from "react";

interface Circle {
  id: string;
  name: string;
  description: string | null;
  memberCount: number;
  inviteCode: string;
  isActive: boolean;
  createdAt: string;
}

interface Props {
  circles: Circle[];
  onCreateCircle: (
    name: string,
    description: string,
  ) => Promise<{ ok: boolean; error?: string }>;
}

export function SyndicateCircle({ circles, onCreateCircle }: Props) {
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [copiedCode, setCopiedCode] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function copyInviteCode(code: string) {
    navigator.clipboard.writeText(`${window.location.origin}/join-circle?code=${code}`);
    setCopiedCode(code);
    setTimeout(() => setCopiedCode(null), 2000);
  }

  async function handleCreate() {
    if (!name.trim()) return;
    setIsSubmitting(true);
    setError(null);
    const result = await onCreateCircle(name.trim(), description.trim());
    setIsSubmitting(false);
    if (!result.ok) {
      setError(result.error ?? "Failed to create circle. Please try again.");
      return;
    }
    setName("");
    setDescription("");
    setCreating(false);
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h3 className="font-semibold text-fg">Syndicate Circles</h3>
          <p className="text-sm text-fg-muted mt-0.5">
            Pool your network with trusted GPs and co-investors to share warm introductions
          </p>
        </div>
        <button
          onClick={() => setCreating(true)}
          className="shrink-0 rounded-lg bg-accent px-3 py-2 text-xs font-medium text-white hover:bg-accent/90 transition-colors"
        >
          + New Circle
        </button>
      </div>

      {/* Create circle form */}
      {creating && (
        <div className="rounded-xl border border-accent/30 bg-accent/5 p-5 flex flex-col gap-4">
          <p className="text-sm font-medium text-fg">Create a new syndicate circle</p>
          <div>
            <label className="text-xs text-fg-muted mb-1 block">Circle name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Industrial RE Syndicate, Austin GP Collective"
              className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-fg placeholder:text-fg-muted focus:outline-none focus:ring-1 focus:ring-accent"
            />
          </div>
          <div>
            <label className="text-xs text-fg-muted mb-1 block">Description (optional)</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What's the focus of this group?"
              rows={2}
              className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-fg placeholder:text-fg-muted focus:outline-none focus:ring-1 focus:ring-accent resize-none"
            />
          </div>
          {error && (
            <p className="text-xs text-status-danger">{error}</p>
          )}
          <div className="flex gap-2">
            <button
              onClick={() => { setCreating(false); setName(""); setDescription(""); setError(null); }}
              className="flex-1 rounded-lg border border-line py-2 text-sm text-fg-muted hover:text-fg transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleCreate}
              disabled={!name.trim() || isSubmitting}
              className="flex-1 rounded-lg bg-accent py-2 text-sm font-medium text-white hover:bg-accent/90 disabled:opacity-40 transition-colors"
            >
              {isSubmitting ? "Creating…" : "Create Circle"}
            </button>
          </div>
        </div>
      )}

      {/* Circles list */}
      {circles.length === 0 && !creating ? (
        <div className="rounded-xl border border-dashed border-line p-8 text-center">
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-accent/10">
            <svg className="h-6 w-6 text-accent" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
              <path d="M18 18.72a9.094 9.094 0 0 0 3.741-.479 3 3 0 0 0-4.682-2.72m.94 3.198.001.031c0 .225-.012.447-.037.666A11.944 11.944 0 0 1 12 21c-2.17 0-4.207-.576-5.963-1.584A6.062 6.062 0 0 1 6 18.719m12 0a5.971 5.971 0 0 0-.941-3.197m0 0A5.995 5.995 0 0 0 12 12.75a5.995 5.995 0 0 0-5.058 2.772m0 0a3 3 0 0 0-4.681 2.72 8.986 8.986 0 0 0 3.74.477m.94-3.197a5.971 5.971 0 0 0-.94 3.197M15 6.75a3 3 0 1 1-6 0 3 3 0 0 1 6 0Zm6 3a2.25 2.25 0 1 1-4.5 0 2.25 2.25 0 0 1 4.5 0Zm-13.5 0a2.25 2.25 0 1 1-4.5 0 2.25 2.25 0 0 1 4.5 0Z" />
            </svg>
          </div>
          <p className="text-sm font-medium text-fg">No circles yet</p>
          <p className="text-xs text-fg-muted mt-1">
            Create a circle to pool your network with trusted co-investors and get warm paths to their contacts.
          </p>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {circles.map((circle) => (
            <div
              key={circle.id}
              className="rounded-xl border border-line bg-surface p-5 flex flex-col gap-3"
            >
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="font-medium text-sm text-fg">{circle.name}</p>
                  {circle.description && (
                    <p className="text-xs text-fg-muted mt-0.5 line-clamp-2">{circle.description}</p>
                  )}
                </div>
                <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium ${circle.isActive ? "bg-emerald-500/15 text-emerald-400" : "bg-fg-muted/10 text-fg-muted"}`}>
                  {circle.isActive ? "Active" : "Inactive"}
                </span>
              </div>

              <div className="flex items-center gap-3 text-xs text-fg-muted">
                <span className="flex items-center gap-1">
                  <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                    <path d="M15 19.128a9.38 9.38 0 0 0 2.625.372 9.337 9.337 0 0 0 4.121-.952 4.125 4.125 0 0 0-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 0 1 8.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0 1 11.964-3.07M12 6.375a3.375 3.375 0 1 1-6.75 0 3.375 3.375 0 0 1 6.75 0Zm8.25 2.25a2.625 2.625 0 1 1-5.25 0 2.625 2.625 0 0 1 5.25 0Z" />
                  </svg>
                  {circle.memberCount} member{circle.memberCount !== 1 ? "s" : ""}
                </span>
              </div>

              <div className="rounded-lg border border-line bg-bg p-2.5 flex items-center justify-between gap-2">
                <span className="text-xs text-fg-muted font-mono truncate">{circle.inviteCode}</span>
                <button
                  onClick={() => copyInviteCode(circle.inviteCode)}
                  className="shrink-0 text-xs text-accent hover:text-accent/80 transition-colors"
                >
                  {copiedCode === circle.inviteCode ? "Copied!" : "Copy invite link"}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
