"use client";

import React from "react";

export interface CommTemplate {
  id: string;
  title: string;
  type: "quarterly_update" | "capital_call" | "distribution_notice" | "annual_report" | "ad_hoc";
  lastSentDate: string | null;
  recipientCount: number | null;
  status: "draft" | "sent" | "scheduled";
}

const TYPE_STYLES: Record<CommTemplate["type"], { label: string; cls: string }> = {
  quarterly_update:    { label: "Quarterly Update",    cls: "bg-amber-900/30 text-gold-400 border-amber-700/30" },
  capital_call:        { label: "Capital Call",        cls: "bg-emerald-900/30 text-emerald-300 border-emerald-700/30" },
  distribution_notice: { label: "Distribution Notice", cls: "bg-blue-900/30 text-blue-300 border-blue-700/30" },
  annual_report:       { label: "Annual Report",       cls: "bg-purple-900/30 text-purple-300 border-purple-700/30" },
  ad_hoc:              { label: "Ad Hoc",              cls: "bg-surface-1 text-fg-muted border-line" },
};

const STATUS_STYLES: Record<CommTemplate["status"], { label: string; cls: string }> = {
  draft:     { label: "Draft",     cls: "bg-surface-1 text-fg-muted border-line" },
  sent:      { label: "Sent",      cls: "bg-emerald-900/30 text-emerald-300 border-emerald-700/30" },
  scheduled: { label: "Scheduled", cls: "bg-amber-900/30 text-gold-300 border-amber-700/30" },
};

const STATUS_ORDER: CommTemplate["status"][] = ["scheduled", "draft", "sent"];
const STATUS_HEADINGS: Record<CommTemplate["status"], string> = {
  scheduled: "Scheduled",
  draft: "Drafts",
  sent: "Sent",
};

function TemplateCard({ t }: { t: CommTemplate }) {
  const type = TYPE_STYLES[t.type];
  const status = STATUS_STYLES[t.status];

  return (
    <div className="bg-surface-1 rounded-2xl p-5 flex flex-col gap-3 border border-line">
      <div className="flex items-start justify-between gap-3">
        <span className="text-fg-primary font-display font-semibold text-sm leading-snug flex-1">{t.title}</span>
        <span className={`inline-flex items-center shrink-0 px-2 py-0.5 rounded-lg text-xs font-mono border ${status.cls}`}>
          {status.label}
        </span>
      </div>

      <div className="flex flex-wrap gap-2">
        <span className={`inline-flex items-center px-2 py-0.5 rounded-lg text-xs font-mono border ${type.cls}`}>
          {type.label}
        </span>
        <span className="inline-flex items-center px-2 py-0.5 rounded-lg text-xs font-mono border border-line bg-surface-0 text-fg-muted cursor-default select-none">
          Preview
        </span>
      </div>

      <div className="flex items-center justify-between gap-4 text-xs text-fg-muted pt-1 border-t border-line">
        <span>
          {t.lastSentDate ? (
            <>Last sent <span className="text-fg-secondary font-mono">{t.lastSentDate}</span></>
          ) : (
            <span className="italic">Never sent</span>
          )}
        </span>
        {t.recipientCount !== null && (
          <span className="text-fg-secondary font-mono">{t.recipientCount.toLocaleString()} recipients</span>
        )}
      </div>
    </div>
  );
}

function GroupSection({ status, items }: { status: CommTemplate["status"]; items: CommTemplate[] }) {
  if (items.length === 0) return null;
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-3">
        <span className="text-fg-secondary font-display font-semibold text-sm">{STATUS_HEADINGS[status]}</span>
        <span className="h-px flex-1 bg-line" />
        <span className="text-fg-muted font-mono text-xs">{items.length}</span>
      </div>
      <div className="grid gap-3 grid-cols-1 md:grid-cols-2 lg:grid-cols-3">
        {items.map((t) => (
          <TemplateCard key={t.id} t={t} />
        ))}
      </div>
    </div>
  );
}

export function ShareholderComms({ templates }: { templates: CommTemplate[] }) {
  const grouped = STATUS_ORDER.reduce<Record<CommTemplate["status"], CommTemplate[]>>(
    (acc, s) => ({ ...acc, [s]: templates.filter((t) => t.status === s) }),
    { scheduled: [], draft: [], sent: [] }
  );

  const total = templates.length;

  return (
    <div className="bg-surface-0 rounded-2xl p-6 flex flex-col gap-6 border border-line">
      <div className="flex items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h2 className="text-fg-primary font-display font-semibold text-xl">Shareholder Communications</h2>
          <p className="text-fg-muted text-sm">ForgeGlobal-style LP update center with templated fund communications.</p>
        </div>
        {total > 0 && (
          <span className="shrink-0 text-fg-muted font-mono text-sm bg-surface-1 border border-line rounded-xl px-3 py-1">
            {total} template{total !== 1 ? "s" : ""}
          </span>
        )}
      </div>

      {total === 0 ? (
        <div className="flex items-center justify-center py-16 text-fg-muted text-sm border border-line rounded-2xl bg-surface-1">
          No communication templates configured.
        </div>
      ) : (
        <div className="flex flex-col gap-8">
          {STATUS_ORDER.map((s) => (
            <GroupSection key={s} status={s} items={grouped[s]} />
          ))}
        </div>
      )}
    </div>
  );
}
