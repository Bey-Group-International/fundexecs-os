"use client";

import { useEffect, useState } from "react";

// Sticky section rail for the Settings page. Plain anchor links drive the
// navigation (so /settings#help and /settings#integrations land directly), and
// a lightweight IntersectionObserver scrollspy warms the active item to gold as
// you move down the page. Server-rendered content stays the source of truth;
// this only decorates it.

export interface SettingsSection {
  id: string;
  label: string;
}

export function SettingsNav({ sections }: { sections: SettingsSection[] }) {
  const [active, setActive] = useState(sections[0]?.id ?? "");

  useEffect(() => {
    const els = sections
      .map((s) => document.getElementById(s.id))
      .filter((el): el is HTMLElement => el !== null);
    if (!els.length) return;

    const observer = new IntersectionObserver(
      (entries) => {
        // The topmost section currently intersecting wins.
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible[0]) setActive(visible[0].target.id);
      },
      { rootMargin: "-72px 0px -55% 0px", threshold: 0 },
    );

    els.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, [sections]);

  return (
    <nav className="flex flex-col gap-0.5">
      {sections.map((s) => {
        const isActive = active === s.id;
        return (
          <a
            key={s.id}
            href={`#${s.id}`}
            onClick={() => setActive(s.id)}
            className={`group flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition ${
              isActive
                ? "bg-surface-2 text-fg-primary"
                : "text-fg-secondary hover:bg-surface-2/60 hover:text-fg-primary"
            }`}
          >
            <span
              className={`h-4 w-px rounded-full transition-all ${
                isActive ? "bg-gold-400" : "bg-line group-hover:bg-fg-muted"
              }`}
              aria-hidden
            />
            {s.label}
          </a>
        );
      })}
    </nav>
  );
}
