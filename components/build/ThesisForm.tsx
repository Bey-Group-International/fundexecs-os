"use client";

import { useRef, useState, type KeyboardEvent } from "react";
import { inputClass } from "./DraftWithEarn";
import { createThesis } from "./actions";

// A removable tag-chip input. Type a value and press Enter or comma to add a
// chip; chips can be removed. The current set is submitted to the server as a
// single comma-joined hidden field so the existing `createThesis` toList()
// parser reads it unchanged.
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
      {/* Submitted to the server as a comma-joined string for toList() parsing. */}
      <input type="hidden" name={name} value={value.join(", ")} />
    </div>
  );
}

// Create-a-thesis form with chip inputs. Posts to the existing createThesis
// server action and resets its interactive state on submit.
export function ThesisForm() {
  const [assetClasses, setAssetClasses] = useState<string[]>([]);
  const [geographies, setGeographies] = useState<string[]>([]);
  const formRef = useRef<HTMLFormElement>(null);

  return (
    <form
      ref={formRef}
      action={async (formData) => {
        await createThesis(formData);
        formRef.current?.reset();
        setAssetClasses([]);
        setGeographies([]);
      }}
      className="mb-6 grid gap-3 rounded-xl border border-line bg-surface-1 p-4 sm:grid-cols-2"
    >
      <input name="title" placeholder="Thesis title" className={`${inputClass} sm:col-span-2`} />
      <textarea
        name="summary"
        rows={2}
        placeholder="One-paragraph summary"
        className={`${inputClass} resize-none sm:col-span-2`}
      />
      <ChipInput
        name="asset_classes"
        label="Asset classes"
        placeholder="Type and press Enter…"
        value={assetClasses}
        onChange={setAssetClasses}
      />
      <ChipInput
        name="geographies"
        label="Geographies"
        placeholder="Type and press Enter…"
        value={geographies}
        onChange={setGeographies}
      />
      <input name="check_size_min" type="number" placeholder="Check size min ($)" className={inputClass} />
      <input name="check_size_max" type="number" placeholder="Check size max ($)" className={inputClass} />
      <input name="target_irr" type="number" step="0.1" placeholder="Target IRR (%)" className={inputClass} />
      <input name="target_moic" type="number" step="0.1" placeholder="Target MOIC (x)" className={inputClass} />
      <button className="justify-self-start rounded-md bg-gold-400 px-4 py-2 text-sm font-medium text-surface-0 transition hover:bg-gold-300 sm:col-span-2">
        Add thesis
      </button>
    </form>
  );
}
