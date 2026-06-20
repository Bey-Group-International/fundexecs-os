"use client";

import { useState } from "react";
import { inputClass } from "./DraftWithEarn";
import { formVehicle } from "./formation-actions";

// AngelList-style fund/SPV formation wizard. A compact, collapsible 3-step
// flow: pick a vehicle type, fill the details, review and create. Submits via
// a server-action form so the new entity (and optional seeded share classes)
// land through formVehicle.

type VehicleType = "gp" | "management_co" | "fund" | "spv" | "holdco" | "other";

const TYPES: { key: VehicleType; label: string; desc: string }[] = [
  { key: "gp", label: "GP", desc: "General partner — carries and controls the fund." },
  { key: "management_co", label: "Management Co.", desc: "Operating company that earns the management fee." },
  { key: "fund", label: "Fund", desc: "Pooled vehicle with LPs investing across deals." },
  { key: "spv", label: "SPV", desc: "Single-deal vehicle pooling LPs into one investment." },
  { key: "holdco", label: "Holdco", desc: "Holding company that owns other entities." },
  { key: "other", label: "Other", desc: "Any other legal entity in your structure." },
];

const TYPE_LABEL: Record<string, string> = Object.fromEntries(TYPES.map((t) => [t.key, t.label]));

// Mirrors the server defaults so Review can preview what will be seeded.
function defaultClassNames(type: VehicleType): string {
  if (type === "fund" || type === "spv") return "LP Interest, GP Interest";
  if (type === "gp" || type === "management_co") return "Membership";
  return "Common";
}

export function FormationWizard({ parents }: { parents: { id: string; name: string }[] }) {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState(0);
  const [type, setType] = useState<VehicleType>("spv");
  const [name, setName] = useState("");
  const [jurisdiction, setJurisdiction] = useState("");
  const [formationDate, setFormationDate] = useState("");
  const [parentId, setParentId] = useState("");
  const [notes, setNotes] = useState("");
  const [seed, setSeed] = useState(true);

  function reset() {
    setStep(0);
    setType("spv");
    setName("");
    setJurisdiction("");
    setFormationDate("");
    setParentId("");
    setNotes("");
    setSeed(true);
  }

  function close() {
    setOpen(false);
    reset();
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mb-6 rounded-md border border-gold-500/40 bg-gold-500/10 px-3 py-1.5 text-xs font-medium text-gold-300 transition hover:bg-gold-500/20"
      >
        + Form a vehicle
      </button>
    );
  }

  const total = 3;
  const canNext = step === 0 ? true : step === 1 ? name.trim().length > 0 : true;

  return (
    <div className="mb-6 rounded-xl border border-line bg-surface-1 p-4">
      {/* Header + progress */}
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="font-mono text-[10px] uppercase tracking-wider text-gold-400">
            Form a vehicle · Step {step + 1} of {total}
          </span>
        </div>
        <button
          type="button"
          onClick={close}
          className="rounded-md border border-line px-2 py-1 text-xs text-fg-muted transition hover:text-fg-primary"
        >
          ✕
        </button>
      </div>
      <div className="mb-4 h-1 w-full overflow-hidden rounded-full bg-surface-2">
        <div className="h-full bg-gold-400 transition-all" style={{ width: `${((step + 1) / total) * 100}%` }} />
      </div>

      {/* Step 1 — Vehicle type */}
      {step === 0 ? (
        <div className="flex flex-col gap-2">
          {TYPES.map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => setType(t.key)}
              className={`flex flex-col items-start gap-0.5 rounded-lg border px-3 py-2 text-left transition ${
                type === t.key
                  ? "border-gold-500/60 bg-gold-500/10"
                  : "border-line bg-surface-0 hover:border-gold-500/30"
              }`}
            >
              <span className="text-sm font-medium text-fg-primary">{t.label}</span>
              <span className="text-xs text-fg-muted">{t.desc}</span>
            </button>
          ))}
        </div>
      ) : null}

      {/* Step 2 — Details */}
      {step === 1 ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1 sm:col-span-2">
            <span className="text-xs text-fg-secondary">Name</span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Entity name"
              className={inputClass}
              autoFocus
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs text-fg-secondary">Jurisdiction</span>
            <input
              value={jurisdiction}
              onChange={(e) => setJurisdiction(e.target.value)}
              placeholder="e.g. Delaware"
              className={inputClass}
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs text-fg-secondary">Formation date</span>
            <input
              value={formationDate}
              onChange={(e) => setFormationDate(e.target.value)}
              type="date"
              className={inputClass}
            />
          </label>
          <label className="flex flex-col gap-1 sm:col-span-2">
            <span className="text-xs text-fg-secondary">Parent entity</span>
            <select value={parentId} onChange={(e) => setParentId(e.target.value)} className={inputClass}>
              <option value="">— none (parent entity) —</option>
              {parents.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 sm:col-span-2">
            <span className="text-xs text-fg-secondary">Notes</span>
            <input
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Notes"
              className={inputClass}
            />
          </label>
        </div>
      ) : null}

      {/* Step 3 — Review + create */}
      {step === 2 ? (
        <form action={formVehicle} onSubmit={() => close()} className="flex flex-col gap-3">
          {/* Hidden carriers for the server action */}
          <input type="hidden" name="entity_type" value={type} />
          <input type="hidden" name="name" value={name} />
          <input type="hidden" name="jurisdiction" value={jurisdiction} />
          <input type="hidden" name="formation_date" value={formationDate} />
          <input type="hidden" name="parent_entity_id" value={parentId} />
          <input type="hidden" name="notes" value={notes} />

          <div className="flex flex-col gap-2 rounded-lg border border-line bg-surface-0 p-3">
            <Row label="Type" value={TYPE_LABEL[type]} />
            <Row label="Name" value={name.trim() || "—"} />
            <Row label="Jurisdiction" value={jurisdiction.trim() || "—"} />
            <Row label="Formation date" value={formationDate || "—"} />
            <Row label="Parent" value={parents.find((p) => p.id === parentId)?.name ?? "—"} />
            <Row label="Notes" value={notes.trim() || "—"} />
          </div>

          <label className="flex items-start gap-2 rounded-lg border border-line bg-surface-0 px-3 py-2.5">
            <input
              type="checkbox"
              name="seed_classes"
              checked={seed}
              onChange={(e) => setSeed(e.target.checked)}
              className="mt-0.5 accent-gold-400"
            />
            <span className="flex flex-col">
              <span className="text-sm text-fg-primary">Seed default share classes</span>
              <span className="text-xs text-fg-muted">{defaultClassNames(type)}</span>
            </span>
          </label>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setStep(1)}
              className="rounded-md border border-line px-3 py-1.5 text-xs text-fg-secondary transition hover:text-fg-primary"
            >
              ← Back
            </button>
            <button
              type="submit"
              disabled={!name.trim()}
              className="rounded-md bg-gold-400 px-4 py-2 text-sm font-medium text-surface-0 transition hover:bg-gold-300 disabled:opacity-60"
            >
              Create vehicle
            </button>
          </div>
        </form>
      ) : null}

      {/* Nav for steps 1 & 2 */}
      {step < 2 ? (
        <div className="mt-4 flex items-center gap-2">
          <button
            type="button"
            onClick={() => setStep((s) => Math.max(0, s - 1))}
            disabled={step === 0}
            className="rounded-md border border-line px-3 py-1.5 text-xs text-fg-secondary transition hover:text-fg-primary disabled:opacity-40"
          >
            ← Back
          </button>
          <button
            type="button"
            onClick={() => canNext && setStep((s) => s + 1)}
            disabled={!canNext}
            className="rounded-md bg-gold-400 px-4 py-1.5 text-sm font-medium text-surface-0 transition hover:bg-gold-300 disabled:opacity-60"
          >
            {step === 1 ? "Review →" : "Next →"}
          </button>
        </div>
      ) : null}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="font-mono text-[9px] uppercase tracking-wider text-fg-muted">{label}</span>
      <span className="text-sm text-fg-secondary">{value}</span>
    </div>
  );
}
