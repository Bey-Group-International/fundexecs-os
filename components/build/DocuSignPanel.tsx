"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import {
  listDocuSignTemplates,
  sendSubscriptionEnvelope,
  getEnvelopeStatus,
  listSentEnvelopes,
  refreshPendingEnvelopes,
  listSignerContacts,
} from "./docusign-actions";

// Terminal states no longer change — excluded from polling and per-row refresh.
const TERMINAL_STATUSES = new Set(["completed", "declined", "voided"]);
const isTerminal = (status: string) =>
  TERMINAL_STATUSES.has(status.toLowerCase());

interface SignerContact {
  name: string;
  email: string;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Template {
  id: string;
  name: string;
}

interface SentEnvelope {
  id: string;
  subject: string;
  status: string;
  created: string;
  signer_name: string | null;
  signer_email: string | null;
}

// ---------------------------------------------------------------------------
// Status badge
// ---------------------------------------------------------------------------

const STATUS_COLOR: Record<string, string> = {
  sent: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300",
  delivered:
    "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/40 dark:text-yellow-300",
  completed:
    "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300",
  declined: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300",
  voided: "bg-neutral-100 text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400",
  unknown: "bg-neutral-100 text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400",
};

function StatusBadge({ status }: { status: string }) {
  const cls =
    STATUS_COLOR[status.toLowerCase()] ??
    "bg-neutral-100 text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400";
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium capitalize ${cls}`}
    >
      {status}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Modal
// ---------------------------------------------------------------------------

interface ModalProps {
  onClose: () => void;
  onSent: (envelope: SentEnvelope) => void;
}

function SendModal({ onClose, onSent }: ModalProps) {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [loadingTemplates, setLoadingTemplates] = useState(true);
  const [templateId, setTemplateId] = useState("");
  const [signerName, setSignerName] = useState("");
  const [signerEmail, setSignerEmail] = useState("");
  const [signerRole, setSignerRole] = useState("signer");
  const [subject, setSubject] = useState("Subscription Agreement — Please Sign");
  const [error, setError] = useState<string | null>(null);
  const [contacts, setContacts] = useState<SignerContact[]>([]);
  const [isPending, startTransition] = useTransition();
  const dialogRef = useRef<HTMLDivElement>(null);

  // Fetch templates + known signer contacts on mount
  useEffect(() => {
    listDocuSignTemplates()
      .then((t) => {
        setTemplates(t);
        if (t.length > 0) setTemplateId(t[0].id);
      })
      .finally(() => setLoadingTemplates(false));
    listSignerContacts().then(setContacts).catch(() => setContacts([]));
  }, []);

  // When the typed name matches a known investor contact, auto-fill their email.
  function handleNameChange(value: string) {
    setSignerName(value);
    const match = contacts.find(
      (c) => c.name && c.name.toLowerCase() === value.trim().toLowerCase(),
    );
    if (match && match.email && !signerEmail) setSignerEmail(match.email);
  }

  // Close on backdrop click
  const handleBackdrop = useCallback(
    (e: React.MouseEvent) => {
      if (e.target === e.currentTarget) onClose();
    },
    [onClose]
  );

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const fd = new FormData();
    fd.set("template_id", templateId);
    fd.set("signer_name", signerName);
    fd.set("signer_email", signerEmail);
    fd.set("signer_role", signerRole);
    fd.set("subject", subject);

    startTransition(async () => {
      const result = await sendSubscriptionEnvelope(fd);
      if ("error" in result) {
        setError(result.error);
        return;
      }
      onSent({
        id: result.envelopeId,
        subject,
        status: "sent",
        created: new Date().toISOString(),
        signer_name: signerName,
        signer_email: signerEmail,
      });
      onClose();
    });
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4"
      onClick={handleBackdrop}
    >
      <div
        ref={dialogRef}
        className="w-full max-w-md rounded-xl bg-white shadow-2xl dark:bg-neutral-900"
        role="dialog"
        aria-modal="true"
        aria-label="Send Subscription Docs"
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-neutral-200 px-6 py-4 dark:border-neutral-700">
          <h2 className="text-base font-semibold text-neutral-900 dark:text-neutral-100">
            Send Subscription Docs
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1 text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300"
            aria-label="Close"
          >
            <svg
              className="h-5 w-5"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        </div>

        {/* Body */}
        <form onSubmit={handleSubmit} className="space-y-4 px-6 py-5">
          {/* Template selector */}
          <div>
            <label className="block text-sm font-medium text-neutral-700 dark:text-neutral-300">
              DocuSign Template
            </label>
            {loadingTemplates ? (
              <div className="mt-1 h-9 animate-pulse rounded-md bg-neutral-100 dark:bg-neutral-800" />
            ) : templates.length === 0 ? (
              <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">
                No templates found. Create one in DocuSign first.
              </p>
            ) : (
              <select
                value={templateId}
                onChange={(e) => setTemplateId(e.target.value)}
                required
                className="mt-1 block w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-neutral-600 dark:bg-neutral-800 dark:text-neutral-100"
              >
                {templates.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            )}
          </div>

          {/* LP Name */}
          <div>
            <label className="block text-sm font-medium text-neutral-700 dark:text-neutral-300">
              LP Name
            </label>
            <input
              type="text"
              value={signerName}
              onChange={(e) => handleNameChange(e.target.value)}
              required
              placeholder="Jane Smith"
              list="docusign-signer-contacts"
              autoComplete="off"
              className="mt-1 block w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm shadow-sm placeholder:text-neutral-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-neutral-600 dark:bg-neutral-800 dark:text-neutral-100"
            />
            {contacts.length > 0 && (
              <datalist id="docusign-signer-contacts">
                {contacts.map((c) => (
                  <option key={c.email} value={c.name}>
                    {c.email}
                  </option>
                ))}
              </datalist>
            )}
          </div>

          {/* LP Email */}
          <div>
            <label className="block text-sm font-medium text-neutral-700 dark:text-neutral-300">
              LP Email
            </label>
            <input
              type="email"
              value={signerEmail}
              onChange={(e) => setSignerEmail(e.target.value)}
              required
              placeholder="lp@example.com"
              className="mt-1 block w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm shadow-sm placeholder:text-neutral-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-neutral-600 dark:bg-neutral-800 dark:text-neutral-100"
            />
          </div>

          {/* Signer Role */}
          <div>
            <label className="block text-sm font-medium text-neutral-700 dark:text-neutral-300">
              Template Role Name
            </label>
            <input
              type="text"
              value={signerRole}
              onChange={(e) => setSignerRole(e.target.value)}
              required
              placeholder="signer"
              className="mt-1 block w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm shadow-sm placeholder:text-neutral-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-neutral-600 dark:bg-neutral-800 dark:text-neutral-100"
            />
            <p className="mt-1 text-xs text-neutral-400">
              Must match the role name defined in your DocuSign template.
            </p>
          </div>

          {/* Subject */}
          <div>
            <label className="block text-sm font-medium text-neutral-700 dark:text-neutral-300">
              Email Subject
            </label>
            <input
              type="text"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              required
              className="mt-1 block w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-neutral-600 dark:bg-neutral-800 dark:text-neutral-100"
            />
          </div>

          {error && (
            <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-900/30 dark:text-red-400">
              {error}
            </p>
          )}

          <div className="flex justify-end gap-3 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="rounded-md border border-neutral-300 bg-white px-4 py-2 text-sm font-medium text-neutral-700 hover:bg-neutral-50 dark:border-neutral-600 dark:bg-neutral-800 dark:text-neutral-200 dark:hover:bg-neutral-700"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isPending || loadingTemplates || templates.length === 0}
              className="inline-flex items-center gap-2 rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isPending && (
                <svg
                  className="h-4 w-4 animate-spin"
                  viewBox="0 0 24 24"
                  fill="none"
                >
                  <circle
                    className="opacity-25"
                    cx="12"
                    cy="12"
                    r="10"
                    stroke="currentColor"
                    strokeWidth="4"
                  />
                  <path
                    className="opacity-75"
                    fill="currentColor"
                    d="M4 12a8 8 0 018-8v8H4z"
                  />
                </svg>
              )}
              {isPending ? "Sending…" : "Send Envelope"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Envelope row
// ---------------------------------------------------------------------------

function EnvelopeRow({
  envelope,
  onRefresh,
}: {
  envelope: SentEnvelope;
  onRefresh: (id: string, status: string) => void;
}) {
  const [refreshing, setRefreshing] = useState(false);

  async function handleRefresh() {
    setRefreshing(true);
    try {
      const { status } = await getEnvelopeStatus(envelope.id);
      onRefresh(envelope.id, status);
    } finally {
      setRefreshing(false);
    }
  }

  const date = new Date(envelope.created).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });

  return (
    <tr className="group border-b border-neutral-100 last:border-0 dark:border-neutral-800">
      <td className="py-3 pr-4 text-sm text-neutral-900 dark:text-neutral-100">
        <p className="font-medium">{envelope.subject}</p>
        {envelope.signer_name && (
          <p className="text-xs text-neutral-500 dark:text-neutral-400">
            {envelope.signer_name}
            {envelope.signer_email ? ` · ${envelope.signer_email}` : ""}
          </p>
        )}
      </td>
      <td className="py-3 pr-4 text-sm text-neutral-500 dark:text-neutral-400 whitespace-nowrap">
        {date}
      </td>
      <td className="py-3 pr-4 whitespace-nowrap">
        <StatusBadge status={envelope.status} />
      </td>
      <td className="py-3">
        {isTerminal(envelope.status) ? (
          <span className="sr-only">Final status</span>
        ) : (
          <button
            type="button"
            onClick={handleRefresh}
            disabled={refreshing}
            title="Refresh status from DocuSign"
            className="rounded p-1 text-neutral-400 hover:text-blue-600 disabled:opacity-50 dark:hover:text-blue-400"
          >
            <svg
              className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`}
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M4 4v5h.582M20 20v-5h-.581M5.635 19A9 9 0 1 0 4.582 9"
              />
            </svg>
          </button>
        )}
      </td>
    </tr>
  );
}

// ---------------------------------------------------------------------------
// DocuSignPanel (main export)
// ---------------------------------------------------------------------------

export function DocuSignPanel() {
  const [open, setOpen] = useState(false);
  const [envelopes, setEnvelopes] = useState<SentEnvelope[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);

  // Load existing envelopes on mount
  useEffect(() => {
    listSentEnvelopes()
      .then(setEnvelopes)
      .finally(() => setLoading(false));
  }, []);

  function handleSent(envelope: SentEnvelope) {
    setEnvelopes((prev) => [envelope, ...prev]);
  }

  function handleRefresh(id: string, status: string) {
    setEnvelopes((prev) =>
      prev.map((e) => (e.id === id ? { ...e, status } : e))
    );
  }

  const applyUpdates = useCallback((updates: Array<{ id: string; status: string }>) => {
    if (updates.length === 0) return;
    const byId = new Map(updates.map((u) => [u.id, u.status]));
    setEnvelopes((prev) =>
      prev.map((e) => (byId.has(e.id) ? { ...e, status: byId.get(e.id)! } : e))
    );
  }, []);

  const pendingCount = envelopes.filter((e) => !isTerminal(e.status)).length;

  async function syncAll() {
    setSyncing(true);
    try {
      applyUpdates(await refreshPendingEnvelopes());
    } finally {
      setSyncing(false);
    }
  }

  // Auto-poll pending envelopes every 30s while any remain in flight. The sweep
  // is a single server round-trip; it stops once everything is terminal.
  useEffect(() => {
    if (pendingCount === 0) return;
    const id = setInterval(() => {
      refreshPendingEnvelopes()
        .then(applyUpdates)
        .catch(() => {});
    }, 30_000);
    return () => clearInterval(id);
  }, [pendingCount, applyUpdates]);

  return (
    <section className="rounded-xl border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900">
      {/* Panel header */}
      <div className="flex items-center justify-between border-b border-neutral-200 px-6 py-4 dark:border-neutral-800">
        <div className="flex items-center gap-3">
          {/* DocuSign icon */}
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#FFCC00]/10">
            <svg
              viewBox="0 0 24 24"
              className="h-5 w-5 fill-[#FFCC00]"
              aria-hidden="true"
            >
              <path d="M12 2C6.477 2 2 6.477 2 12s4.477 10 10 10 10-4.477 10-10S17.523 2 12 2zm0 18a8 8 0 1 1 0-16 8 8 0 0 1 0 16zm-1-5h2v2h-2zm0-8h2v6h-2z" />
            </svg>
          </span>
          <div>
            <h3 className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">
              Subscription Documents
            </h3>
            <p className="text-xs text-neutral-500 dark:text-neutral-400">
              Send and track LP subscription agreements via DocuSign
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {pendingCount > 0 && (
            <button
              type="button"
              onClick={syncAll}
              disabled={syncing}
              title="Refresh every pending envelope from DocuSign"
              className="inline-flex items-center gap-1.5 rounded-lg border border-neutral-300 bg-white px-3 py-1.5 text-sm font-medium text-neutral-700 hover:bg-neutral-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-neutral-600 dark:bg-neutral-800 dark:text-neutral-200 dark:hover:bg-neutral-700"
            >
              <svg
                className={`h-4 w-4 ${syncing ? "animate-spin" : ""}`}
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M4 4v5h.582M20 20v-5h-.581M5.635 19A9 9 0 1 0 4.582 9"
                />
              </svg>
              {syncing ? "Syncing…" : `Refresh all (${pendingCount})`}
            </button>
          )}
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
          >
            <svg
              className="h-4 w-4"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M12 4v16m8-8H4"
              />
            </svg>
            Send Subscription Docs
          </button>
        </div>
      </div>

      {/* Envelope list */}
      <div className="px-6 py-4">
        {loading ? (
          <div className="space-y-3">
            {[1, 2, 3].map((i) => (
              <div
                key={i}
                className="h-10 animate-pulse rounded-md bg-neutral-100 dark:bg-neutral-800"
              />
            ))}
          </div>
        ) : envelopes.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-10 text-center">
            <svg
              className="h-10 w-10 text-neutral-300 dark:text-neutral-700"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={1.5}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M21.75 6.75v10.5a2.25 2.25 0 0 1-2.25 2.25h-15a2.25 2.25 0 0 1-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0 0 19.5 4.5h-15a2.25 2.25 0 0 0-2.25 2.25m19.5 0v.243a2.25 2.25 0 0 1-1.07 1.916l-7.5 4.615a2.25 2.25 0 0 1-2.36 0L3.32 8.91a2.25 2.25 0 0 1-1.07-1.916V6.75"
              />
            </svg>
            <p className="text-sm font-medium text-neutral-500 dark:text-neutral-400">
              No envelopes sent yet
            </p>
            <p className="text-xs text-neutral-400 dark:text-neutral-500">
              Send your first subscription agreement using the button above.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[500px] text-left">
              <thead>
                <tr className="border-b border-neutral-100 dark:border-neutral-800">
                  <th className="pb-2 pr-4 text-xs font-medium text-neutral-500 dark:text-neutral-400">
                    Document / Recipient
                  </th>
                  <th className="pb-2 pr-4 text-xs font-medium text-neutral-500 dark:text-neutral-400 whitespace-nowrap">
                    Sent
                  </th>
                  <th className="pb-2 pr-4 text-xs font-medium text-neutral-500 dark:text-neutral-400">
                    Status
                  </th>
                  <th className="pb-2 text-xs font-medium text-neutral-500 dark:text-neutral-400 sr-only">
                    Refresh
                  </th>
                </tr>
              </thead>
              <tbody>
                {envelopes.map((e) => (
                  <EnvelopeRow
                    key={e.id}
                    envelope={e}
                    onRefresh={handleRefresh}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Modal */}
      {open && (
        <SendModal onClose={() => setOpen(false)} onSent={handleSent} />
      )}
    </section>
  );
}
