import type { SVGProps } from "react";
import type { InstallGlyph, InstallStep } from "@/lib/pwa/install-platform";

type IconProps = SVGProps<SVGSVGElement>;

function base(props: IconProps) {
  return {
    width: 18,
    height: 18,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.7,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
    ...props,
  };
}

// The iOS / macOS Share glyph — a box with an arrow rising out of it. Drawn to
// match the system icon closely enough that a reader can find it on screen.
function ShareGlyph(p: IconProps) {
  return (
    <svg {...base(p)}>
      <path d="M12 3v12" />
      <path d="m8 7 4-4 4 4" />
      <path d="M8 11H6.5A1.5 1.5 0 0 0 5 12.5v7A1.5 1.5 0 0 0 6.5 21h11a1.5 1.5 0 0 0 1.5-1.5v-7a1.5 1.5 0 0 0-1.5-1.5H16" />
    </svg>
  );
}

// "Add to Home Screen" — a plus inside a rounded square, as iOS draws it.
function AddGlyph(p: IconProps) {
  return (
    <svg {...base(p)}>
      <rect x="4" y="4" width="16" height="16" rx="3.5" />
      <path d="M12 8.5v7M8.5 12h7" />
    </svg>
  );
}

// The macOS Dock: a shelf with app tiles.
function DockGlyph(p: IconProps) {
  return (
    <svg {...base(p)}>
      <rect x="3" y="14" width="18" height="6" rx="2" />
      <path d="M7 17h.01M11 17h.01M15 17h.01" />
      <path d="M12 4v6M9 7l3 3 3-3" />
    </svg>
  );
}

// Safari's compass.
function SafariGlyph(p: IconProps) {
  return (
    <svg {...base(p)}>
      <circle cx="12" cy="12" r="9" />
      <path d="m15.5 8.5-2.3 5.2-4.7 1.8 2.3-5.2z" fill="currentColor" stroke="none" />
    </svg>
  );
}

// A menu bar with a highlighted item — File › Add to Dock.
function MenuGlyph(p: IconProps) {
  return (
    <svg {...base(p)}>
      <path d="M3 5h18" />
      <rect x="5" y="8" width="11" height="12" rx="1.5" />
      <path d="M8 12h5M8 15.5h5" />
    </svg>
  );
}

function CheckGlyph(p: IconProps) {
  return (
    <svg {...base(p)}>
      <circle cx="12" cy="12" r="9" />
      <path d="m8.5 12.5 2.3 2.3 4.7-5" />
    </svg>
  );
}

function UpdateGlyph(p: IconProps) {
  return (
    <svg {...base(p)}>
      <path d="M20 12a8 8 0 1 1-2.3-5.7" />
      <path d="M20 4v5h-5" />
    </svg>
  );
}

const GLYPHS: Record<InstallGlyph, (p: IconProps) => React.JSX.Element> = {
  share: ShareGlyph,
  add: AddGlyph,
  dock: DockGlyph,
  safari: SafariGlyph,
  menu: MenuGlyph,
  check: CheckGlyph,
  update: UpdateGlyph,
};

// Numbered, glyph-led install steps. Shared by the phone prompt sheet, the
// desktop dashboard card, the download banner and the /install page, so every
// surface describes the same gesture the same way. Size tunes the type scale
// for a dense card ("sm") or a standalone page ("md").
export function InstallSteps({
  steps,
  size = "sm",
  className = "",
}: {
  steps: InstallStep[];
  size?: "sm" | "md";
  className?: string;
}) {
  const md = size === "md";
  return (
    <ol className={`space-y-${md ? "3" : "2.5"} ${className}`}>
      {steps.map((step, i) => {
        const Glyph = GLYPHS[step.glyph];
        return (
          <li key={i} className="flex items-start gap-3">
            <span
              className={`relative flex shrink-0 items-center justify-center rounded-xl border border-gold-500/30 bg-gold-500/10 text-gold-300 ${
                md ? "h-11 w-11" : "h-9 w-9"
              }`}
            >
              <Glyph width={md ? 22 : 18} height={md ? 22 : 18} />
              <span
                aria-hidden
                className="absolute -left-1.5 -top-1.5 flex h-4.5 min-w-[1.125rem] items-center justify-center rounded-full bg-gold-500 px-1 font-mono text-[10px] font-semibold leading-none text-on-gold"
              >
                {i + 1}
              </span>
            </span>
            <span className="min-w-0 flex-1 pt-0.5">
              <span className={`block font-medium text-fg-primary ${md ? "text-[15px]" : "text-[13px]"}`}>
                <span className="sr-only">Step {i + 1}: </span>
                {step.title}
              </span>
              {step.detail && (
                <span className={`mt-0.5 block leading-snug text-fg-secondary ${md ? "text-[13px]" : "text-[11.5px]"}`}>
                  {step.detail}
                </span>
              )}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
