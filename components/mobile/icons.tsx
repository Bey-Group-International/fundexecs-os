// Lightweight inline-SVG icon set for the mobile app shell. The project ships
// no icon dependency, so these are hand-rolled, stroke-based glyphs sized to
// the 1.5rem touch grid and inheriting `currentColor` for theme-awareness.
import type { SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement>;

function base(props: IconProps) {
  return {
    width: 22,
    height: 22,
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

export function HomeIcon(p: IconProps) {
  return (
    <svg {...base(p)}>
      <path d="M3 10.5 12 3l9 7.5" />
      <path d="M5 9.5V21h14V9.5" />
      <path d="M9.5 21v-6h5v6" />
    </svg>
  );
}

export function EarnIcon(p: IconProps) {
  // Earn's coin / spark mark.
  return (
    <svg {...base(p)}>
      <circle cx="12" cy="12" r="8.4" />
      <path d="M12 7.5v9M9.4 9.6c.7-1 4.6-1.3 4.6.8 0 1.9-4.2 1.5-4.2 3.4 0 2 3.8 1.9 4.6.7" />
    </svg>
  );
}

export function DealsIcon(p: IconProps) {
  return (
    <svg {...base(p)}>
      <path d="M3 7.5 12 3l9 4.5-9 4.5L3 7.5Z" />
      <path d="M3 12l9 4.5L21 12M3 16.5 12 21l9-4.5" />
    </svg>
  );
}

export function NetworkIcon(p: IconProps) {
  return (
    <svg {...base(p)}>
      <circle cx="6" cy="7" r="2.4" />
      <circle cx="18" cy="7" r="2.4" />
      <circle cx="12" cy="17" r="2.4" />
      <path d="M7.8 8.6 10.5 15M16.2 8.6 13.5 15M8 7h8" />
    </svg>
  );
}

export function MoreIcon(p: IconProps) {
  return (
    <svg {...base(p)}>
      <circle cx="5" cy="12" r="1.4" />
      <circle cx="12" cy="12" r="1.4" />
      <circle cx="19" cy="12" r="1.4" />
    </svg>
  );
}

export function PlusIcon(p: IconProps) {
  return (
    <svg {...base(p)}>
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

export function SparkIcon(p: IconProps) {
  return (
    <svg {...base(p)}>
      <path d="M12 3v4M12 17v4M3 12h4M17 12h4M5.6 5.6l2.8 2.8M15.6 15.6l2.8 2.8M18.4 5.6l-2.8 2.8M8.4 15.6l-2.8 2.8" />
    </svg>
  );
}

export function DocIcon(p: IconProps) {
  return (
    <svg {...base(p)}>
      <path d="M6 3h8l4 4v14H6V3Z" />
      <path d="M14 3v4h4M9 13h6M9 17h6" />
    </svg>
  );
}

export function ContactIcon(p: IconProps) {
  return (
    <svg {...base(p)}>
      <circle cx="12" cy="8" r="3.4" />
      <path d="M5 20c0-3.3 3.1-5.5 7-5.5s7 2.2 7 5.5" />
    </svg>
  );
}

export function TaskIcon(p: IconProps) {
  return (
    <svg {...base(p)}>
      <path d="M4.5 6.5h15M4.5 12h15M4.5 17.5h9" />
    </svg>
  );
}

export function ShieldIcon(p: IconProps) {
  return (
    <svg {...base(p)}>
      <path d="M12 3 5 6v5c0 4.4 3 8 7 10 4-2 7-5.6 7-10V6l-7-3Z" />
      <path d="m9 12 2 2 4-4" />
    </svg>
  );
}

export function BellIcon(p: IconProps) {
  return (
    <svg {...base(p)}>
      <path d="M6 9a6 6 0 0 1 12 0c0 5 2 6 2 6H4s2-1 2-6Z" />
      <path d="M10 20a2 2 0 0 0 4 0" />
    </svg>
  );
}

export function DataRoomIcon(p: IconProps) {
  return (
    <svg {...base(p)}>
      <path d="M3 7.5C3 6 5 5 8 5s5 1 5 2.5M3 7.5V17c0 1.5 2 2.5 5 2.5s5-1 5-2.5V7.5" />
      <path d="M3 12.2c0 1.5 2 2.5 5 2.5s5-1 5-2.5" />
      <rect x="13" y="9" width="8" height="11" rx="1.2" />
      <path d="M17 9V7.5M15.5 13h3M15.5 16h3" />
    </svg>
  );
}

export function UploadIcon(p: IconProps) {
  return (
    <svg {...base(p)}>
      <path d="M12 16V5M8 8.5 12 4.5l4 4M5 19h14" />
    </svg>
  );
}

export function UsersIcon(p: IconProps) {
  return (
    <svg {...base(p)}>
      <circle cx="9" cy="8" r="3" />
      <path d="M3.5 19c0-2.8 2.4-4.6 5.5-4.6S14.5 16.2 14.5 19" />
      <path d="M16 5.2A3 3 0 0 1 16 11M17 14.6c2.3.5 4 2.1 4 4.4" />
    </svg>
  );
}

export function CapitalIcon(p: IconProps) {
  return (
    <svg {...base(p)}>
      <rect x="3" y="6" width="18" height="12" rx="2" />
      <circle cx="12" cy="12" r="2.4" />
      <path d="M6 9v6M18 9v6" />
    </svg>
  );
}

export function ChevronIcon(p: IconProps) {
  return (
    <svg {...base(p)}>
      <path d="m9 6 6 6-6 6" />
    </svg>
  );
}

export function CloseIcon(p: IconProps) {
  return (
    <svg {...base(p)}>
      <path d="M6 6l12 12M18 6 6 18" />
    </svg>
  );
}

export function SettingsIcon(p: IconProps) {
  return (
    <svg {...base(p)}>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 2.5v2.2M12 19.3v2.2M4.2 7l1.9 1.1M17.9 15.9l1.9 1.1M4.2 17l1.9-1.1M17.9 8.1l1.9-1.1" />
    </svg>
  );
}

export function ReportIcon(p: IconProps) {
  return (
    <svg {...base(p)}>
      <path d="M4 20V4M20 20H4M8 16v-4M12 16V8M16 16v-6" />
    </svg>
  );
}

export function WalletIcon(p: IconProps) {
  return (
    <svg {...base(p)}>
      <rect x="3" y="6" width="18" height="13" rx="2.2" />
      <path d="M3 9h18M16.5 13.5h1.5" />
    </svg>
  );
}

export function StoreIcon(p: IconProps) {
  return (
    <svg {...base(p)}>
      <path d="M4 9V6.5A1.5 1.5 0 0 1 5.5 5h13A1.5 1.5 0 0 1 20 6.5V9M4 9h16M4 9v10h16V9" />
      <path d="M9 19v-5h6v5" />
    </svg>
  );
}

export function HelpIcon(p: IconProps) {
  return (
    <svg {...base(p)}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M9.6 9.4c.3-1.3 4.8-1.6 4.8 1.2 0 1.8-2.4 1.7-2.4 3.4M12 17.2h.01" />
    </svg>
  );
}

export function CalendarIcon(p: IconProps) {
  return (
    <svg {...base(p)}>
      <rect x="3.5" y="5" width="17" height="16" rx="2" />
      <path d="M3.5 9.5h17M8 3v4M16 3v4" />
    </svg>
  );
}

export function UserIcon(p: IconProps) {
  return <ContactIcon {...p} />;
}
