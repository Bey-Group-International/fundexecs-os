"use client";

import { useState, type ReactNode } from "react";

export interface EntityTabDef {
  key: string;
  label: string;
  content: ReactNode;
}

// Sub-navigation shell for the Entity workspace. Server-rendered section content
// (structure, cap table, modeling, people) is passed in as nodes; this client
// shell just toggles which one is visible, so the page is one focused view at a
// time instead of a long scroll.
export function EntityTabs({ overview, tabs }: { overview: ReactNode; tabs: EntityTabDef[] }) {
  const [active, setActive] = useState(tabs[0]?.key ?? "");

  return (
    <div>
      {overview}
      <div className="mb-5 flex gap-0.5 overflow-x-auto border-b border-line">
        {tabs.map((t) => {
          const on = t.key === active;
          return (
            <button
              key={t.key}
              type="button"
              onClick={() => setActive(t.key)}
              aria-current={on ? "page" : undefined}
              className={`group relative -mb-px whitespace-nowrap rounded-t-md px-3 py-2.5 text-sm transition ${
                on ? "font-medium text-fg-primary" : "text-fg-secondary hover:bg-surface-1 hover:text-fg-primary"
              }`}
            >
              {t.label}
              <span
                aria-hidden
                className={`absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-gradient-to-r from-gold-300 to-gold-500 transition-opacity ${
                  on ? "opacity-100" : "opacity-0 group-hover:opacity-30"
                }`}
              />
            </button>
          );
        })}
      </div>
      {tabs.map((t) => (
        <div key={t.key} className={t.key === active ? "block" : "hidden"}>
          {t.content}
        </div>
      ))}
    </div>
  );
}
