"use client";

type Shortcut = { keys: string[]; label: string };
type Group = { title: string; items: Shortcut[] };

const GROUPS: Group[] = [
  {
    title: "Move",
    items: [
      { keys: ["W", "A", "S", "D"], label: "Walk" },
      { keys: ["↑", "↓", "←", "→"], label: "Walk" },
      { keys: ["Click"], label: "Walk to a spot" },
      { keys: ["F"], label: "Follow a nearby teammate" },
    ],
  },
  {
    title: "Floor",
    items: [
      { keys: ["X"], label: "Use the hotspot you're standing on" },
      { keys: ["T"], label: "Talk to a nearby executive" },
      { keys: ["⌘", "K"], label: "Open the command palette" },
    ],
  },
  {
    title: "Express",
    items: [
      { keys: ["1"], label: "Wave 👋" },
      { keys: ["2"], label: "Thumbs up 👍" },
      { keys: ["3"], label: "Heart ❤️" },
      { keys: ["4"], label: "Celebrate 🎉" },
    ],
  },
];

/**
 * A floor tool: the keyboard-shortcuts cheat sheet. Opens from the "?" button
 * or the "?" key — a quick reference for movement, floor actions, and emotes.
 * Pure static reference, no backend.
 */
export function FloorShortcuts({ onClose }: { onClose: () => void }) {
  return (
    <>
      <div className="absolute inset-0 z-30" onClick={onClose} />
      <div
        className="pointer-events-auto absolute left-1/2 top-1/2 z-40 w-[340px] max-w-[92%] -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-2xl border shadow-xl backdrop-blur-sm"
        style={{
          background: "rgba(10,8,6,0.95)",
          borderColor: "rgba(201,168,76,0.35)",
          fontFamily: "Georgia, 'Times New Roman', serif",
        }}
      >
        <div className="flex items-center justify-between px-3.5 py-2.5" style={{ borderBottom: "1px solid rgba(201,168,76,0.18)" }}>
          <span className="font-mono text-[10px] uppercase tracking-[0.18em]" style={{ color: "#c9a84c" }}>
            Floor Controls
          </span>
          <button type="button" onClick={onClose} aria-label="Close" className="text-fg-muted transition-colors hover:text-fg-primary">
            ✕
          </button>
        </div>

        <div className="flex flex-col gap-3 p-3.5">
          {GROUPS.map((g) => (
            <div key={g.title}>
              <p className="mb-1.5 font-mono text-[8px] uppercase tracking-[0.16em] text-fg-muted">{g.title}</p>
              <ul className="flex flex-col gap-1">
                {g.items.map((s, i) => (
                  <li key={i} className="flex items-center gap-2 text-[12px]">
                    <span className="flex shrink-0 items-center gap-1">
                      {s.keys.map((k) => (
                        <kbd
                          key={k}
                          className="grid min-w-[18px] place-items-center rounded px-1.5 py-0.5 text-[10px]"
                          style={{
                            color: "#e8e2d4",
                            background: "rgba(201,168,76,0.1)",
                            border: "1px solid rgba(201,168,76,0.3)",
                            fontFamily: "ui-monospace, monospace",
                          }}
                        >
                          {k}
                        </kbd>
                      ))}
                    </span>
                    <span className="text-fg-primary">{s.label}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
