"use client";

import { useState, type KeyboardEvent } from "react";
import type { ScreeningCriteria } from "@/lib/skills/screening-criteria";

// A removable tag-chip input. Type a value and press Enter or comma to add a
// chip; Backspace on an empty draft removes the last chip. The current set is
// submitted as a single comma-joined hidden field so the server action's
// list parser reads it unchanged. Copied from ThesisForm's ChipInput.
function ChipInput({
  name,
  label,
  placeholder,
  value,
  onChange,
}: {
  name: string;
  label: string;
  placeholder: string;
  value: string[];
  onChange: (next: string[]) => void;
}) {
  const [draft, setDraft] = useState("");

  function commit(raw: string) {
    const parts = raw
      .split(/[,\n]/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (!parts.length) return;
    const next = [...value];
    for (const p of parts) {
      if (!next.some((v) => v.toLowerCase() === p.toLowerCase())) next.push(p);
    }
    onChange(next);
    setDraft("");
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      commit(draft);
    } else if (e.key === "Backspace" && draft === "" && value.length) {
      onChange(value.slice(0, -1));
    }
  }

  function remove(idx: number) {
    onChange(value.filter((_, i) => i !== idx));
  }

  return (
    <div>
      <label className="mb-1 block font-mono text-[10px] uppercase tracking-wider text-fg-muted">
        {label}
      </label>
      <div className="flex flex-wrap items-center gap-1.5 rounded-md border border-line bg-surface-0 px-2 py-1.5 focus-within:border-gold-500/60">
        {value.map((chip, i) => (
          <span
            key={`${chip}-${i}`}
            className="inline-flex items-center gap-1 rounded-full border border-gold-500/40 bg-gold-500/10 px-2 py-0.5 text-xs text-gold-300"
          >
            {chip}
            <button
              type="button"
              onClick={() => remove(i)}
              className="text-gold-400 transition hover:text-gold-300"
              aria-label={`Remove ${chip}`}
            >
              ×
            </button>
          </span>
        ))}
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKeyDown}
          onBlur={() => commit(draft)}
          placeholder={value.length ? "" : placeholder}
          className="min-w-[8ch] flex-1 bg-transparent px-1 py-0.5 text-sm text-fg-primary placeholder:text-fg-muted focus:outline-none"
        />
      </div>
      {/* Submitted to the server as a comma-joined string for list parsing. */}
      <input type="hidden" name={name} value={value.join(", ")} />
    </div>
  );
}

// Shared number-input styling, mirroring MandateEditor's blast-radius fields.
const numberInputClass =
  "rounded-lg border border-line bg-surface-1 px-3 py-2 text-sm text-fg-primary placeholder:text-fg-muted focus:border-gold-500/50 focus:outline-none";

function NumberField({
  name,
  label,
  placeholder,
  defaultValue,
}: {
  name: string;
  label: string;
  placeholder: string;
  defaultValue?: number;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs font-medium text-fg-secondary">{label}</span>
      <input
        type="number"
        name={name}
        min={0}
        step="0.1"
        defaultValue={defaultValue ?? ""}
        placeholder={placeholder}
        className={numberInputClass}
      />
    </label>
  );
}

/**
 * Structured screening-criteria editor. Purely presentational with local chip
 * state — every field submits through the parent mandate <form> via hidden and
 * named inputs (name="criteria_<key>"). No form or data fetching of its own.
 */
export function CriteriaEditor({ initial }: { initial: ScreeningCriteria | null }) {
  const [sectors, setSectors] = useState<string[]>(initial?.sectors ?? []);
  const [geographies, setGeographies] = useState<string[]>(initial?.geographies ?? []);
  const [transactionTypes, setTransactionTypes] = useState<string[]>(
    initial?.transactionTypes ?? [],
  );
  const [exclusions, setExclusions] = useState<string[]>(initial?.exclusions ?? []);

  return (
    <section>
      <h3 className="font-mono text-[11px] uppercase tracking-[0.2em] text-fg-muted">
        Screening criteria
      </h3>
      <p className="mt-1 text-sm text-fg-secondary">
        Structured bounds the screening and sourcing skills score deals against. Every field is
        optional — a dimension you leave silent is simply unscored, never a fabricated bound.
      </p>

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <ChipInput
          name="criteria_sectors"
          label="Sectors"
          placeholder="Type and press Enter…"
          value={sectors}
          onChange={setSectors}
        />
        <ChipInput
          name="criteria_geographies"
          label="Geographies"
          placeholder="Type and press Enter…"
          value={geographies}
          onChange={setGeographies}
        />
        <ChipInput
          name="criteria_transactionTypes"
          label="Transaction types"
          placeholder="Type and press Enter…"
          value={transactionTypes}
          onChange={setTransactionTypes}
        />
        <ChipInput
          name="criteria_exclusions"
          label="Exclusions"
          placeholder="Type and press Enter…"
          value={exclusions}
          onChange={setExclusions}
        />
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <NumberField
          name="criteria_minRevenue"
          label="Min revenue ($M)"
          placeholder="e.g. 10"
          defaultValue={initial?.minRevenue}
        />
        <NumberField
          name="criteria_maxRevenue"
          label="Max revenue ($M)"
          placeholder="e.g. 250"
          defaultValue={initial?.maxRevenue}
        />
        <NumberField
          name="criteria_minEbitda"
          label="Min EBITDA ($M)"
          placeholder="e.g. 2"
          defaultValue={initial?.minEbitda}
        />
        <NumberField
          name="criteria_maxEbitda"
          label="Max EBITDA ($M)"
          placeholder="e.g. 50"
          defaultValue={initial?.maxEbitda}
        />
      </div>

      <div className="mt-3">
        <NumberField
          name="criteria_maxEnterpriseValue"
          label="Max enterprise value ($M)"
          placeholder="e.g. 500"
          defaultValue={initial?.maxEnterpriseValue}
        />
      </div>
    </section>
  );
}
