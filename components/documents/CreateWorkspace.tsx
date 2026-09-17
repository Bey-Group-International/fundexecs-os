"use client";

// Documents › Create — the four ways a document comes into being, in one place.
//
// Each was already possible and none was findable. Templates were reachable
// only from inside a document that already existed; AI drafting appeared as a
// button on empty sections in the Library and nowhere else; the key-materials
// checklist was written and never rendered at all. A "+ New" button in a corner
// of a library is not an answer to "I need to produce a DDQ".
//
// Ordered by how much the firm is handed rather than by how it is implemented:
// what's missing → a scaffold → a draft from your own data → a blank page.
import { useMemo, useState, useTransition } from "react";
import { newBlankDocument, newDocumentFromTemplate } from "./create-actions";
import { GenerateAiButton } from "@/components/build/GenerateAiButton";
import { DATA_ROOM_SECTIONS } from "@/lib/data-room";
import { AI_DRAFTABLE_SECTIONS } from "@/lib/document-create";
import type { MaterialStatus, TemplateGroup } from "@/lib/document-create";

// The sections Earn can draft cold, in data-room order.
const DRAFTABLE_SECTIONS = DATA_ROOM_SECTIONS.filter((s) => AI_DRAFTABLE_SECTIONS.has(s.key));

interface Props {
  materials: MaterialStatus[];
  groups: TemplateGroup[];
  missingCount: number;
  /** Templates already used, so the gallery can say which are in play. */
  usedTemplateSections: string[];
}

export function CreateWorkspace({ materials, groups, missingCount, usedTemplateSections }: Props) {
  const [preview, setPreview] = useState<string | null>(null);
  const [blankOpen, setBlankOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  const covered = useMemo(() => new Set(usedTemplateSections), [usedTemplateSections]);
  const present = materials.length - missingCount;

  return (
    <div className="flex flex-col gap-8">
      {/* ------------------------------------------------- Core materials */}
      <section aria-label="Core materials">
        <header className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
          <div>
            <h3 className="font-display text-lg font-semibold tracking-tight text-fg-primary">
              Core materials
            </h3>
            <p className="mt-0.5 text-xs text-fg-muted">
              The collateral an allocator expects before a first meeting.
            </p>
          </div>
          <span
            className={`shrink-0 rounded-full border px-3 py-1 font-mono text-[11px] uppercase tracking-wider ${
              missingCount === 0
                ? "border-emerald-500/40 text-emerald-300"
                : "border-amber-500/30 text-amber-400"
            }`}
          >
            {present} of {materials.length} in place
          </span>
        </header>

        <div className="grid gap-2 sm:grid-cols-2">
          {materials.map((m) => (
            <article
              key={m.name}
              aria-label={m.name}
              className={`flex flex-wrap items-center gap-2 rounded-xl border px-4 py-3 ${
                m.present ? "border-line bg-surface-0" : "border-line bg-surface-1"
              }`}
            >
              <span
                aria-hidden
                className={`shrink-0 font-mono text-[11px] ${m.present ? "text-emerald-400" : "text-fg-muted"}`}
              >
                {m.present ? "✓" : "○"}
              </span>
              <div className="min-w-0 flex-1 basis-[9rem]">
                <p className={`truncate text-sm ${m.present ? "text-fg-secondary" : "text-fg-primary"}`}>
                  {m.name}
                </p>
                <p className="mt-0.5 truncate font-mono text-[11px] text-fg-muted">
                  {m.sectionLabel}
                </p>
              </div>

              {m.present ? (
                <span className="shrink-0 font-mono text-[11px] uppercase tracking-wider text-emerald-400">
                  In library
                </span>
              ) : (
                <div className="flex shrink-0 flex-wrap items-center gap-1.5">
                  {m.templateId ? (
                    <form
                      action={(fd) =>
                        startTransition(async () => {
                          await newDocumentFromTemplate(fd);
                        })
                      }
                    >
                      <input type="hidden" name="template_id" value={m.templateId} />
                      <input type="hidden" name="section" value={m.section} />
                      <input type="hidden" name="name" value={m.name} />
                      <button
                        type="submit"
                        disabled={pending}
                        title={`Start ${m.name} from a template`}
                        className="rounded-lg border border-gold-500/40 bg-gold-500/10 px-3 py-1.5 font-mono text-[11px] uppercase tracking-wider text-gold-300 transition hover:bg-gold-500/20 disabled:opacity-50"
                      >
                        Template
                      </button>
                    </form>
                  ) : null}
                  {m.aiDraftable ? (
                    <GenerateAiButton sectionKey={m.section} docName={m.name} label={m.name} />
                  ) : null}
                  <form
                    action={(fd) =>
                      startTransition(async () => {
                        await newBlankDocument(fd);
                      })
                    }
                  >
                    <input type="hidden" name="section" value={m.section} />
                    <input type="hidden" name="name" value={m.name} />
                    <button
                      type="submit"
                      disabled={pending}
                      title={`Start ${m.name} from a blank page`}
                      className="rounded-lg border border-line px-3 py-1.5 font-mono text-[11px] uppercase tracking-wider text-fg-secondary transition hover:border-gold-500/40 hover:text-gold-300 disabled:opacity-50"
                    >
                      Blank
                    </button>
                  </form>
                </div>
              )}
            </article>
          ))}
        </div>
      </section>

      {/* ------------------------------------------------------ Templates */}
      <section aria-label="Start from a template">
        <header className="mb-3">
          <h3 className="font-display text-lg font-semibold tracking-tight text-fg-primary">
            Start from a template
          </h3>
          <p className="mt-0.5 text-xs text-fg-muted">
            Institutional scaffolds with the sections an allocator reads for. Each opens as a draft
            you edit — nothing is published by creating it.
          </p>
        </header>

        <div className="flex flex-col gap-5">
          {groups.map((g) => (
            <div key={g.section}>
              <p className="mb-1.5 font-mono text-[11px] uppercase tracking-[0.16em] text-fg-muted">
                {g.sectionLabel}
                {covered.has(g.section) ? (
                  <span
                    title="Your library already has a document in this section"
                    className="ml-2 text-emerald-400"
                  >
                    ✓
                  </span>
                ) : null}
              </p>
              <div className="grid gap-2 sm:grid-cols-2">
                {g.templates.map((t) => (
                  <article
                    key={t.id}
                    aria-label={t.label}
                    className="flex flex-col gap-2 rounded-xl border border-line bg-surface-0 px-4 py-3"
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-fg-primary">{t.label}</p>
                      <p className="mt-0.5 text-xs leading-snug text-fg-muted">{t.description}</p>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <form
                        action={(fd) =>
                          startTransition(async () => {
                            await newDocumentFromTemplate(fd);
                          })
                        }
                      >
                        <input type="hidden" name="template_id" value={t.id} />
                        <button
                          type="submit"
                          disabled={pending}
                          className="rounded-lg border border-gold-500/40 bg-gold-500/10 px-3 py-1.5 font-mono text-[11px] uppercase tracking-wider text-gold-300 transition hover:bg-gold-500/20 disabled:opacity-50"
                        >
                          {pending ? "…" : "Use template"}
                        </button>
                      </form>
                      <button
                        type="button"
                        onClick={() => setPreview(preview === t.id ? null : t.id)}
                        aria-expanded={preview === t.id}
                        className="rounded-lg border border-line px-3 py-1.5 font-mono text-[11px] uppercase tracking-wider text-fg-muted transition hover:text-fg-primary"
                      >
                        {preview === t.id ? "Hide" : "Preview"}
                      </button>
                    </div>
                    {preview === t.id ? (
                      <pre className="max-h-64 overflow-y-auto whitespace-pre-wrap rounded-lg border border-line/60 bg-surface-1 p-3 font-mono text-[11px] leading-relaxed text-fg-secondary">
                        {t.content}
                      </pre>
                    ) : null}
                  </article>
                ))}
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ---------------------------------------------------- Blank + Earn */}
      <section aria-label="Start from scratch">
        <header className="mb-3">
          <h3 className="font-display text-lg font-semibold tracking-tight text-fg-primary">
            Start from scratch
          </h3>
          <p className="mt-0.5 text-xs text-fg-muted">
            A blank document in any section, or let Earn draft one from your Build foundation.
          </p>
        </header>

        <div className="rounded-xl border border-line bg-surface-0 px-4 py-3">
          {blankOpen ? (
            <form
              action={(fd) =>
                startTransition(async () => {
                  await newBlankDocument(fd);
                })
              }
              className="flex flex-wrap items-center gap-2"
            >
              <input
                name="name"
                placeholder="Document name (optional)"
                className="min-w-[10rem] flex-1 rounded-md border border-line bg-surface-1 px-3 py-2 text-sm text-fg-primary placeholder:text-fg-muted focus:border-gold-500/60 focus:outline-none"
              />
              <select
                name="section"
                defaultValue="other"
                aria-label="Section"
                className="rounded-md border border-line bg-surface-1 px-3 py-2 text-sm text-fg-secondary focus:border-gold-500/60 focus:outline-none"
              >
                {DATA_ROOM_SECTIONS.map((s) => (
                  <option key={s.key} value={s.key}>
                    {s.label}
                  </option>
                ))}
              </select>
              <button
                type="submit"
                disabled={pending}
                className="rounded-lg border border-gold-500/40 bg-gold-500/10 px-3 py-2 font-mono text-[11px] uppercase tracking-wider text-gold-300 transition hover:bg-gold-500/20 disabled:opacity-50"
              >
                {pending ? "Creating…" : "Create"}
              </button>
              <button
                type="button"
                onClick={() => setBlankOpen(false)}
                className="font-mono text-[11px] uppercase tracking-wider text-fg-muted hover:text-fg-secondary"
              >
                Cancel
              </button>
            </form>
          ) : (
            <div className="flex flex-col gap-3">
              <button
                type="button"
                onClick={() => setBlankOpen(true)}
                className="self-start rounded-lg border border-gold-500/40 bg-gold-500/10 px-3 py-1.5 font-mono text-[11px] uppercase tracking-wider text-gold-300 transition hover:bg-gold-500/20"
              >
                + Blank document
              </button>

              <div>
                <p className="mb-1.5 text-xs text-fg-muted">
                  Or let Earn draft a section from your firm data:
                </p>
                {/* Each button carries its section beside it. GenerateAiButton
                    renders a fixed "✦ AI Draft" label with the section only in a
                    tooltip — fine in the Library, where the button sits inside a
                    row that names itself, but four of them side by side here
                    would be four identical buttons with nothing to choose
                    between. */}
                <div className="grid gap-1.5 sm:grid-cols-2">
                  {DRAFTABLE_SECTIONS.map((s) => (
                    <div
                      key={s.key}
                      className="flex flex-wrap items-center gap-2 rounded-lg border border-line/60 bg-surface-1 px-3 py-2"
                    >
                      <span className="min-w-0 flex-1 basis-[8rem] truncate text-sm text-fg-secondary">
                        {s.label}
                      </span>
                      <GenerateAiButton sectionKey={s.key} label={s.label} />
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
