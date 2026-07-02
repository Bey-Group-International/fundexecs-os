"use client";

import { useState } from "react";
import { DOCUMENT_TEMPLATE_LIBRARY, getTemplatesBySection } from "@/lib/document-template-library";

export function TemplatePicker({
  section,
  onSelect,
  onClose,
}: {
  section: string;
  onSelect: (content: string, name: string) => void;
  onClose: () => void;
}) {
  const sectionTemplates = getTemplatesBySection(section);
  const others = DOCUMENT_TEMPLATE_LIBRARY.filter((t) => t.section !== section);
  const [preview, setPreview] = useState<string | null>(null);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
      <div className="flex w-full max-w-2xl flex-col gap-0 overflow-hidden rounded-2xl border border-line bg-surface-0 shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-line px-5 py-4">
          <div>
            <h2 className="font-display text-base font-semibold text-fg-primary">Template Library</h2>
            <p className="mt-0.5 text-xs text-fg-muted">Pick a template to start from — or start blank.</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1.5 text-fg-muted hover:text-fg-primary"
          >
            ✕
          </button>
        </div>

        {/* Body */}
        <div className="flex min-h-0 flex-1 overflow-hidden">
          {/* Template list */}
          <div className="flex w-64 shrink-0 flex-col gap-1 overflow-y-auto border-r border-line p-3">
            {sectionTemplates.length > 0 && (
              <>
                <p className="mb-1 px-1 font-mono text-[9px] uppercase tracking-wider text-gold-400">
                  For this section
                </p>
                {sectionTemplates.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    onMouseEnter={() => setPreview(t.id)}
                    onClick={() => onSelect(t.content, t.label)}
                    className={`rounded-lg px-3 py-2 text-left transition ${
                      preview === t.id
                        ? "bg-gold-500/10 border border-gold-500/30"
                        : "border border-transparent hover:bg-surface-1"
                    }`}
                  >
                    <p className="text-sm font-medium text-fg-primary">{t.label}</p>
                    <p className="mt-0.5 text-[11px] text-fg-muted">{t.description}</p>
                  </button>
                ))}
                {others.length > 0 && (
                  <p className="mb-1 mt-2 px-1 font-mono text-[9px] uppercase tracking-wider text-fg-muted">
                    All templates
                  </p>
                )}
              </>
            )}
            {(sectionTemplates.length === 0 ? DOCUMENT_TEMPLATE_LIBRARY : others).map((t) => (
              <button
                key={t.id}
                type="button"
                onMouseEnter={() => setPreview(t.id)}
                onClick={() => onSelect(t.content, t.label)}
                className={`rounded-lg px-3 py-2 text-left transition ${
                  preview === t.id
                    ? "bg-gold-500/10 border border-gold-500/30"
                    : "border border-transparent hover:bg-surface-1"
                }`}
              >
                <p className="text-sm font-medium text-fg-primary">{t.label}</p>
                <p className="mt-0.5 text-[11px] text-fg-muted">{t.description}</p>
              </button>
            ))}
          </div>

          {/* Preview */}
          <div className="min-h-0 flex-1 overflow-y-auto p-4">
            {preview ? (
              <>
                <p className="mb-2 font-mono text-[10px] uppercase tracking-wider text-gold-400">Preview</p>
                <pre className="whitespace-pre-wrap font-mono text-[11px] leading-relaxed text-fg-secondary">
                  {DOCUMENT_TEMPLATE_LIBRARY.find((t) => t.id === preview)?.content ?? ""}
                </pre>
              </>
            ) : (
              <div className="flex h-full items-center justify-center">
                <p className="text-xs text-fg-muted">Hover a template to preview</p>
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-line px-5 py-3">
          <button
            type="button"
            onClick={() => onSelect("", "")}
            className="text-sm text-fg-muted hover:text-fg-primary"
          >
            Start blank →
          </button>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-line px-4 py-1.5 text-sm text-fg-secondary hover:text-fg-primary"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
