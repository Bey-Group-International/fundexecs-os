"use client";

// The report, a tab at a time.
//
// Every panel stays mounted and the inactive ones are hidden, rather than
// rendered only while chosen. Two of them hold work in progress: the follow-up
// draft somebody is part-way through editing, and the recording's position.
// Unmounting either on a tab switch would throw it away — a draft lost to
// glancing at the transcript is exactly the edit people make while checking
// what was said.
//
// The tab is the URL hash, so a link to `#follow-up` from the header, the
// sidebar or the meetings list opens that tab, and a reload stays on it.
import { useCallback, useEffect, useRef, useState } from "react";
import { tabFromHash, tabHash, type ReportTab, type ReportTabSpec } from "@/lib/meetings/report-tabs";

export function ReportTabs({
  tabs,
  panels,
  aside,
}: {
  tabs: ReportTabSpec[];
  /** The content of each tab, rendered on the server. */
  panels: Partial<Record<ReportTab, React.ReactNode>>;
  /** Beside every tab on a wide screen; the Details tab on a narrow one. */
  aside: React.ReactNode;
}) {
  const available = tabs.map((t) => t.id);
  const availableKey = available.join(",");
  // The overview until mounted: the server has no hash to read, and guessing
  // otherwise would hydrate one tab and then jump to another.
  const [tab, setTab] = useState<ReportTab>("overview");
  const barRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const ids = availableKey.split(",") as ReportTab[];
    const sync = (scroll: boolean) => {
      const next = tabFromHash(window.location.hash, ids);
      setTab(next);
      // A link to a tab from further down the page (the sidebar's "Review and
      // send") should land on it, not leave the reader where they were.
      if (scroll && window.location.hash) {
        requestAnimationFrame(() => barRef.current?.scrollIntoView({ block: "start", behavior: "smooth" }));
      }
    };
    sync(false);
    const onHash = () => sync(true);
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, [availableKey]);

  const choose = useCallback((next: ReportTab) => {
    setTab(next);
    // Replace, not push: switching tabs is not a page the Back button should
    // step through. And not `location.hash =`, which would scroll to the anchor.
    try {
      window.history.replaceState(null, "", `#${tabHash(next)}`);
    } catch { /* sandboxed frame: the tab still changes */ }
  }, []);

  // Arrow keys move along the tabs, as a tablist is expected to.
  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
    const buttons = Array.from(barRef.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]') ?? [])
      // Not the Details tab on a wide screen, where it is display:none.
      .filter((b) => window.getComputedStyle(b).display !== "none");
    const i = buttons.findIndex((b) => b === document.activeElement);
    if (i === -1) return;
    const nextButton = buttons[(i + (e.key === "ArrowRight" ? 1 : buttons.length - 1)) % buttons.length];
    nextButton?.focus();
    nextButton?.click();
    e.preventDefault();
  };

  const showsPanel = (id: ReportTab) =>
    // On a wide screen the Details tab does not exist, so a #details link shows
    // the overview there, with the details beside it as always.
    id === tab ? "block" : id === "overview" && tab === "details" ? "hidden lg:block" : "hidden";

  return (
    <div className="flex flex-col gap-4">
      {/* Sticky, so the way to another tab is never a scroll back up an hour of
          transcript away. Scrolls sideways on a phone rather than wrapping. */}
      <div
        ref={barRef}
        role="tablist"
        aria-label="Report sections"
        onKeyDown={onKeyDown}
        className="sticky top-0 z-20 -mx-4 flex scroll-mt-0 gap-1 overflow-x-auto border-b border-[var(--line)] bg-[var(--surface-0)]/95 px-4 backdrop-blur [scrollbar-width:none] sm:mx-0 sm:px-0"
      >
        {tabs.map((t) => {
          const selected = t.id === tab;
          return (
            <button
              key={t.id}
              type="button"
              role="tab"
              id={`report-tab-${t.id}`}
              aria-selected={selected}
              aria-controls={`report-panel-${t.id}`}
              tabIndex={selected ? 0 : -1}
              onClick={() => choose(t.id)}
              className={`relative flex min-h-11 shrink-0 items-center gap-1.5 whitespace-nowrap px-3 text-sm font-medium transition-colors ${
                t.narrowOnly ? "lg:hidden" : ""
              } ${
                selected
                  ? "text-[var(--fg-primary)] after:absolute after:inset-x-2 after:bottom-0 after:h-0.5 after:rounded-full after:bg-[var(--gold-400)]"
                  : "text-[var(--fg-muted)] hover:text-[var(--fg-secondary)]"
              }`}
            >
              {t.label}
              {t.badge ? (
                <span className="rounded-full bg-[var(--surface-2)] px-1.5 py-0.5 text-[10px] font-semibold tabular-nums text-[var(--fg-secondary)]">
                  {t.badge}
                </span>
              ) : null}
            </button>
          );
        })}
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_320px] lg:items-start">
        <div className="min-w-0">
          {tabs.filter((t) => !t.narrowOnly).map((t) => (
            <div
              key={t.id}
              id={`report-panel-${t.id}`}
              role="tabpanel"
              aria-labelledby={`report-tab-${t.id}`}
              className={showsPanel(t.id)}
            >
              {panels[t.id]}
            </div>
          ))}
        </div>

        {/* Who, where the follow-up stands, and the report's versions. Sticky on
            a wide screen so it stays beside whatever is being read; its own tab
            on a narrow one, where beside is below an hour of transcript. */}
        <aside
          id="report-panel-details"
          role="tabpanel"
          aria-labelledby="report-tab-details"
          className={`${tab === "details" ? "flex" : "hidden"} flex-col gap-5 lg:sticky lg:top-14 lg:flex lg:max-h-[calc(100vh-4.5rem)] lg:overflow-y-auto`}
        >
          {aside}
        </aside>
      </div>
    </div>
  );
}
