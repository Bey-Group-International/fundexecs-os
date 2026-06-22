import Link from "next/link";
import type { InvestorRoomData, RoomCard } from "@/lib/investor-room";

// components/run/InvestorRoom.tsx
// The gated Investor Room (product mockup "Deal Room / Investor Room"): a grid
// of permissioned material cards — each tagged Permissioned · Approved · Logged
// — beside a Compliance State panel that makes the approval posture visible
// before any external action. Spatial state, not decoration: a green gate is a
// real, satisfied control; an amber one is an open item.

// One gate chip. Satisfied gates read green/active; unmet ones read muted amber
// so the operator can see exactly what is still open before sharing.
function Gate({ label, on }: { label: string; on: boolean }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider ${
        on
          ? "border-status-success/40 bg-status-success/10 text-status-success"
          : "border-status-warning/40 bg-status-warning/10 text-status-warning"
      }`}
    >
      <span aria-hidden>{on ? "✓" : "○"}</span>
      {label}
    </span>
  );
}

function MaterialCard({ card }: { card: RoomCard }) {
  const ready = card.permissioned && card.approved && card.logged;
  return (
    <div className="fx-card flex flex-col gap-3 p-4">
      <div className="flex items-start justify-between gap-2">
        <h3 className="text-sm font-semibold text-fg-primary">{card.label}</h3>
        <span
          title={ready ? "Ready to expose" : "Open item before sharing"}
          className={`mt-0.5 h-2 w-2 shrink-0 rounded-full ${
            ready ? "bg-status-success" : "bg-status-warning"
          }`}
        />
      </div>
      <p className="text-xs leading-snug text-fg-secondary">{card.blurb}</p>
      <div className="mt-auto flex flex-wrap gap-1.5">
        <Gate label="Permissioned" on={card.permissioned} />
        <Gate label="Approved" on={card.approved} />
        <Gate label="Logged" on={card.logged} />
      </div>
    </div>
  );
}

// A single compliance control: a state the room asserts holds before external
// action. Reads green when satisfied.
function ComplianceRow({ label, on }: { label: string; on: boolean }) {
  return (
    <li className="flex items-center gap-2 text-sm">
      <span
        aria-hidden
        className={`flex h-4 w-4 items-center justify-center rounded-full text-[10px] ${
          on
            ? "bg-status-success/15 text-status-success"
            : "bg-status-warning/15 text-status-warning"
        }`}
      >
        {on ? "✓" : "!"}
      </span>
      <span className={on ? "text-fg-secondary" : "text-fg-primary"}>{label}</span>
    </li>
  );
}

export function InvestorRoom({ data }: { data: InvestorRoomData }) {
  const { compliance } = data;
  const allClear =
    compliance.investorVerified &&
    compliance.solicitationOff &&
    compliance.materialsApproved &&
    compliance.qaApprovedSources;

  return (
    <div className="fx-ambient mx-auto max-w-6xl">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-widest text-gold-400">
            Investor Room
          </p>
          <h1 className="mt-1 font-display text-xl font-semibold text-fg-primary">
            {data.dealName}
          </h1>
        </div>
        <Link
          href={`/deal/${data.dealId}`}
          className="rounded-md border border-line px-3 py-1.5 text-xs text-fg-secondary transition hover:bg-surface-2 hover:text-fg-primary"
        >
          ← Deal war room
        </Link>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_18rem]">
        {/* Permissioned materials — two columns of cards. */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {data.cards.map((card) => (
            <MaterialCard key={card.key} card={card} />
          ))}
        </div>

        {/* Compliance State — the approval posture, visible before any external
            action (mockup principle). */}
        <aside className="fx-card h-fit p-4">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-fg-primary">Compliance State</h2>
            <span
              className={`rounded-full px-2 py-0.5 font-mono text-[9px] uppercase tracking-wider ${
                allClear
                  ? "bg-status-success/10 text-status-success"
                  : "bg-status-warning/10 text-status-warning"
              }`}
            >
              {allClear ? "Clear" : "Review"}
            </span>
          </div>
          <ul className="flex flex-col gap-2.5">
            <ComplianceRow label="Investor verified" on={compliance.investorVerified} />
            <ComplianceRow label="Solicitation off" on={compliance.solicitationOff} />
            <ComplianceRow label="Materials approved" on={compliance.materialsApproved} />
            <ComplianceRow label="Q&A approved sources" on={compliance.qaApprovedSources} />
          </ul>
          <p className="mt-4 border-t border-line pt-3 text-[11px] leading-snug text-fg-muted">
            Access is gated and logged. Nothing is exposed externally until its
            gates and the compliance state are clear.
          </p>
        </aside>
      </div>
    </div>
  );
}
