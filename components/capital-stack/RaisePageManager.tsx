'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Globe, Copy, Check, ExternalLink, Users } from 'lucide-react';
import { Card, SectionTitle } from '@/components/ui';
import {
  createRaiseShareLink,
  updateRaisePage,
  revokeRaiseShareLink
} from '@/lib/actions/raise-page';
import type { ActiveRaisePage } from '@/lib/queries/raise-page';

/* RaisePageManager — publish / edit / copy / unpublish the public raise page
 * (/r/<token>). Owner/admin-gated by the underlying actions' RLS. Lives on the
 * Capital Stack screen so the public face of the raise sits next to its data. */

export function RaisePageManager({ initial }: { initial: ActiveRaisePage | null }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // Editable copy (seeded from the live page).
  const [title, setTitle] = useState(initial?.title ?? '');
  const [headline, setHeadline] = useState(initial?.headline ?? '');
  const [minCheck, setMinCheck] = useState(initial?.minCheck ? String(initial.minCheck) : '');
  const [showAmounts, setShowAmounts] = useState(initial?.showAmounts ?? false);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  function publish() {
    setError(null);
    startTransition(async () => {
      const res = await createRaiseShareLink();
      if (res.ok) router.refresh();
      else setError(res.error);
    });
  }

  function save() {
    setError(null);
    startTransition(async () => {
      const res = await updateRaisePage({
        title,
        headline,
        minCheck: minCheck ? Number(minCheck.replace(/[^0-9.]/g, '')) : null,
        showAmounts
      });
      if (res.ok) {
        setSavedAt(Date.now());
        router.refresh();
      } else setError(res.error);
    });
  }

  function unpublish() {
    if (!initial) return;
    setError(null);
    startTransition(async () => {
      const res = await revokeRaiseShareLink(initial.token);
      if (res.ok) router.refresh();
      else setError(res.error);
    });
  }

  async function copy() {
    if (!initial) return;
    try {
      await navigator.clipboard.writeText(initial.url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      /* clipboard blocked — the URL is visible to copy manually */
    }
  }

  return (
    <Card className="mt-6 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <SectionTitle eyebrow="Capital · public surface" title="Public raise page" />
        {initial ? (
          <span className="inline-flex items-center gap-1.5 rounded-full border border-success-line bg-success-soft px-2.5 py-0.5 text-[11px] font-semibold text-success">
            <Globe size={12} strokeWidth={2} aria-hidden />
            Live
          </span>
        ) : null}
      </div>

      {!initial ? (
        <div className="mt-3">
          <p className="max-w-[60ch] text-[13px] text-fg-3">
            Publish a shareable, link-only page that shows your raise momentum and lets prospects
            express interest. Amounts stay hidden unless you opt in; the page is not search-indexed.
          </p>
          <button
            type="button"
            onClick={publish}
            disabled={pending}
            className="mt-4 inline-flex items-center gap-2 rounded-xl bg-accent px-4 py-2 text-[13px] font-semibold text-white transition hover:bg-accent-2 disabled:opacity-60"
          >
            <Globe size={15} strokeWidth={2.2} aria-hidden />
            {pending ? 'Publishing…' : 'Publish raise page'}
          </button>
        </div>
      ) : (
        <div className="mt-3 flex flex-col gap-4">
          {/* Link row */}
          <div className="flex flex-wrap items-center gap-2 rounded-xl border border-hairline bg-surface-1 px-3 py-2">
            <span className="truncate text-[12.5px] text-fg-2">{initial.url}</span>
            <div className="ml-auto flex items-center gap-1.5">
              <button
                type="button"
                onClick={copy}
                className="inline-flex items-center gap-1.5 rounded-lg border border-hairline bg-bg-2 px-2.5 py-1 text-[11.5px] font-medium text-fg-2 transition hover:bg-surface-2"
              >
                {copied ? (
                  <Check size={12} strokeWidth={2.4} className="text-success" aria-hidden />
                ) : (
                  <Copy size={12} strokeWidth={2} aria-hidden />
                )}
                {copied ? 'Copied' : 'Copy'}
              </button>
              <a
                href={initial.url}
                target="_blank"
                rel="noreferrer noopener"
                className="inline-flex items-center gap-1.5 rounded-lg border border-hairline bg-bg-2 px-2.5 py-1 text-[11.5px] font-medium text-azure-1 transition hover:bg-surface-2"
              >
                <ExternalLink size={12} strokeWidth={2} aria-hidden />
                Open
              </a>
            </div>
          </div>

          <p className="inline-flex items-center gap-1.5 text-[12px] text-fg-3">
            <Users size={13} strokeWidth={2} aria-hidden />
            <span className="font-semibold text-fg-1">{initial.interestCount}</span> expressed
            interest
          </p>

          {/* Editable copy */}
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="flex flex-col gap-1.5 sm:col-span-2">
              <span className="text-[11.5px] font-medium text-fg-2">Title</span>
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                maxLength={120}
                placeholder="Defaults to your workspace name"
                className={inputCls}
              />
            </label>
            <label className="flex flex-col gap-1.5 sm:col-span-2">
              <span className="text-[11.5px] font-medium text-fg-2">Headline</span>
              <textarea
                value={headline}
                onChange={(e) => setHeadline(e.target.value)}
                rows={2}
                maxLength={280}
                placeholder="One line on what you're raising and why now."
                className={`${inputCls} resize-none`}
              />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="text-[11.5px] font-medium text-fg-2">Minimum check ($)</span>
              <input
                value={minCheck}
                onChange={(e) => setMinCheck(e.target.value)}
                inputMode="numeric"
                maxLength={16}
                placeholder="Optional"
                className={inputCls}
              />
            </label>
            <label className="flex items-center gap-2.5 self-end rounded-xl border border-hairline bg-surface-1 px-3 py-2">
              <input
                type="checkbox"
                checked={showAmounts}
                onChange={(e) => setShowAmounts(e.target.checked)}
                className="h-4 w-4 accent-[var(--accent)]"
              />
              <span className="text-[12.5px] text-fg-2">Show dollar amounts publicly</span>
            </label>
          </div>

          {error ? (
            <p role="alert" className="text-[12.5px] text-danger">
              {error}
            </p>
          ) : null}

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={save}
              disabled={pending}
              className="inline-flex items-center gap-2 rounded-xl bg-accent px-4 py-2 text-[13px] font-semibold text-white transition hover:bg-accent-2 disabled:opacity-60"
            >
              {pending ? 'Saving…' : 'Save changes'}
            </button>
            {savedAt ? <span className="text-[11.5px] text-success">Saved</span> : null}
            <button
              type="button"
              onClick={unpublish}
              disabled={pending}
              className="ml-auto inline-flex items-center rounded-xl border border-hairline px-3 py-2 text-[12.5px] font-medium text-fg-3 transition hover:border-danger-line hover:text-danger disabled:opacity-60"
            >
              Unpublish
            </button>
          </div>
        </div>
      )}
    </Card>
  );
}

const inputCls =
  'w-full rounded-xl border border-hairline bg-surface-1 px-3 py-2 text-[13px] text-fg-1 placeholder:text-fg-4 outline-none transition focus:border-accent-line focus:bg-surface-2';
