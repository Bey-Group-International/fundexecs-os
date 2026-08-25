"use client";

// The left icon nav-rail — the structural shell adopted from the Fund Launch AI
// "scroll-deck" page, re-expressed in this repo's fx tokens (surface ramp, gold
// accent, neural blue) instead of the source's green-brand look.
import {
  DeckIcon,
  BuilderIcon,
  LegalIcon,
  CalcIcon,
  MarketplaceIcon,
  RaiseIcon,
  ManageIcon,
  HelpIcon,
  LockIcon,
} from "./icons";
import { PRIMARY_NAV, MARKETPLACE_NAV, LOCKED_NAV } from "./mock-data";

const ICON_BY_ID: Record<string, (p: { className?: string }) => React.ReactNode> = {
  "scroll-deck": DeckIcon,
  "fund-builder": BuilderIcon,
  legal: LegalIcon,
  calc: CalcIcon,
  marketplace: MarketplaceIcon,
  raise: RaiseIcon,
  manage: ManageIcon,
  help: HelpIcon,
};

function Divider() {
  return (
    <div className="my-1 h-px w-5 bg-gradient-to-r from-transparent via-line to-transparent" />
  );
}

function RailButton({
  id,
  label,
  active,
  locked,
  onSelect,
}: {
  id: string;
  label: string;
  active: boolean;
  locked?: boolean;
  onSelect: () => void;
}) {
  const Icon = ICON_BY_ID[id] ?? DeckIcon;
  return (
    <div className="group relative flex items-center">
      <button
        type="button"
        aria-label={label}
        aria-current={active ? "page" : undefined}
        disabled={locked}
        onClick={onSelect}
        className={[
          "relative flex items-center justify-center rounded-lg border p-2 transition-all duration-200",
          locked
            ? "cursor-not-allowed border-transparent opacity-40"
            : active
              ? "border-line bg-surface-2 text-gold-300 shadow-sm"
              : "border-transparent text-fg-muted hover:bg-surface-2 hover:text-fg-primary",
        ].join(" ")}
      >
        <Icon className="h-5 w-5" />
        {locked ? (
          <span className="absolute -bottom-0.5 -right-0.5 rounded-full bg-surface-3 p-[2px] shadow-sm">
            <LockIcon className="h-2 w-2 text-fg-secondary" />
          </span>
        ) : null}
      </button>
      {/* Hover label — the collapsed rail's tooltip. */}
      <span className="pointer-events-none absolute left-full z-50 ml-2 whitespace-nowrap rounded-md border border-line bg-surface-3 px-2 py-1 text-xs text-fg-primary opacity-0 shadow-lg transition-opacity duration-150 group-hover:opacity-100">
        {label}
      </span>
    </div>
  );
}

export function NavRail({
  active,
  onSelect,
}: {
  active: string;
  onSelect: (id: string) => void;
}) {
  return (
    <aside className="z-[60] flex shrink-0 flex-col items-center gap-1 border-r border-line bg-surface-1 px-2.5 py-4">
      {/* Brand mark */}
      <div className="mb-1 flex h-9 w-9 items-center justify-center rounded-lg bg-gradient-to-br from-gold-300/20 to-neural-400/20 text-gold-300">
        <DeckIcon className="h-5 w-5" />
      </div>

      <Divider />

      <div className="flex flex-1 flex-col items-center gap-1">
        {PRIMARY_NAV.map((item) => (
          <RailButton
            key={item.id}
            id={item.id}
            label={item.label}
            active={active === item.id}
            onSelect={() => onSelect(item.id)}
          />
        ))}

        <Divider />

        {MARKETPLACE_NAV.map((item) => (
          <RailButton
            key={item.id}
            id={item.id}
            label={item.label}
            active={active === item.id}
            onSelect={() => onSelect(item.id)}
          />
        ))}

        <Divider />

        {LOCKED_NAV.map((item) => (
          <RailButton
            key={item.id}
            id={item.id}
            label={`${item.label} · locked`}
            active={false}
            locked
            onSelect={() => {}}
          />
        ))}
      </div>

      <div className="mt-auto flex flex-col items-center gap-1">
        <Divider />
        <RailButton id="help" label="Help" active={false} onSelect={() => {}} />
      </div>
    </aside>
  );
}
