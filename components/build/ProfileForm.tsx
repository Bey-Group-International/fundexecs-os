"use client";

import { useMemo, useState } from "react";
import { AutosaveForm } from "@/components/build/AutosaveForm";
import { inputClass } from "@/components/build/DraftWithEarn";

// Values mirrored from the `organizations` row this form edits.
export type ProfileValues = {
  name: string;
  legal_name: string;
  entity_type: string;
  jurisdiction: string;
  website: string;
  description: string;
  hq_location: string;
  aum_range: string;
  fund_count: string;
  primary_strategy: string;
  operator_role: string;
};

const ENTITY_TYPE_OPTIONS = ["LLC", "LP", "LLP", "Inc.", "GP/LP", "Other"];
const AUM_RANGE_OPTIONS = ["<$50M", "$50–250M", "$250M–1B", "$1–5B", "$5B+"];
const OPERATOR_ROLE_OPTIONS = [
  "GP / Fund Manager",
  "Family Office",
  "Advisor",
  "Allocator/LP",
  "Other",
];

// Fields counted toward the completeness meter.
const COMPLETENESS_KEYS: (keyof ProfileValues)[] = [
  "name",
  "legal_name",
  "entity_type",
  "jurisdiction",
  "website",
  "description",
  "hq_location",
  "aum_range",
  "fund_count",
  "primary_strategy",
  "operator_role",
];

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1.5 text-sm">
      <span className="text-fg-secondary">{label}</span>
      {children}
    </label>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="font-mono text-[11px] uppercase tracking-wider text-fg-muted">
      {children}
    </h3>
  );
}

// A <select> with preset options that still surfaces a previously-saved value
// even when it isn't one of the presets.
function PresetSelect({
  name,
  value,
  onChange,
  options,
  placeholder,
}: {
  name: string;
  value: string;
  onChange: (v: string) => void;
  options: string[];
  placeholder: string;
}) {
  const hasCustom = value !== "" && !options.includes(value);
  return (
    <select
      name={name}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={`${inputClass} bg-surface-1`}
    >
      <option value="">{placeholder}</option>
      {options.map((opt) => (
        <option key={opt} value={opt}>
          {opt}
        </option>
      ))}
      {hasCustom ? <option value={value}>{value}</option> : null}
    </select>
  );
}

export function ProfileForm({
  values,
  action,
}: {
  values: ProfileValues;
  action: (formData: FormData) => Promise<void>;
}) {
  const [form, setForm] = useState<ProfileValues>(values);

  const set = (key: keyof ProfileValues) => (value: string) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const completeness = useMemo(() => {
    const filled = COMPLETENESS_KEYS.filter(
      (k) => form[k].trim() !== "",
    ).length;
    return Math.round((filled / COMPLETENESS_KEYS.length) * 100);
  }, [form]);

  const initial = (form.name.trim() || "?").charAt(0).toUpperCase();

  const identityMeta = [form.entity_type, form.jurisdiction, form.website]
    .map((v) => v.trim())
    .filter(Boolean)
    .join(" · ");

  const firmMeta = [
    form.hq_location.trim(),
    form.aum_range.trim() ? `AUM ${form.aum_range.trim()}` : "",
    form.fund_count.trim()
      ? `${form.fund_count.trim()} fund${form.fund_count.trim() === "1" ? "" : "s"}`
      : "",
    form.primary_strategy.trim(),
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <div className="flex flex-col gap-6 pt-5 lg:flex-row lg:items-start">
      <AutosaveForm action={action} className="flex max-w-xl flex-1 flex-col gap-6">
        {/* Identity --------------------------------------------------------- */}
        <fieldset className="flex flex-col gap-4">
          <SectionTitle>Identity</SectionTitle>
          <Field label="Organization name">
            <input
              name="name"
              value={form.name}
              onChange={(e) => set("name")(e.target.value)}
              className={`${inputClass} bg-surface-1`}
            />
          </Field>
          <Field label="Legal name">
            <input
              name="legal_name"
              value={form.legal_name}
              onChange={(e) => set("legal_name")(e.target.value)}
              className={`${inputClass} bg-surface-1`}
            />
          </Field>
          <Field label="Entity type">
            <PresetSelect
              name="entity_type"
              value={form.entity_type}
              onChange={set("entity_type")}
              options={ENTITY_TYPE_OPTIONS}
              placeholder="Select entity type…"
            />
          </Field>
          <Field label="Jurisdiction">
            <input
              name="jurisdiction"
              value={form.jurisdiction}
              onChange={(e) => set("jurisdiction")(e.target.value)}
              className={`${inputClass} bg-surface-1`}
            />
          </Field>
          <Field label="Website">
            <input
              name="website"
              value={form.website}
              onChange={(e) => set("website")(e.target.value)}
              placeholder="example.com"
              className={`${inputClass} bg-surface-1`}
            />
          </Field>
        </fieldset>

        {/* Firm ------------------------------------------------------------- */}
        <fieldset className="flex flex-col gap-4">
          <SectionTitle>Firm</SectionTitle>
          <Field label="HQ location">
            <input
              name="hq_location"
              value={form.hq_location}
              onChange={(e) => set("hq_location")(e.target.value)}
              className={`${inputClass} bg-surface-1`}
            />
          </Field>
          <Field label="AUM range">
            <PresetSelect
              name="aum_range"
              value={form.aum_range}
              onChange={set("aum_range")}
              options={AUM_RANGE_OPTIONS}
              placeholder="Select AUM range…"
            />
          </Field>
          <Field label="Fund count">
            <input
              name="fund_count"
              type="number"
              min={0}
              value={form.fund_count}
              onChange={(e) => set("fund_count")(e.target.value)}
              className={`${inputClass} bg-surface-1`}
            />
          </Field>
          <Field label="Primary strategy">
            <input
              name="primary_strategy"
              value={form.primary_strategy}
              onChange={(e) => set("primary_strategy")(e.target.value)}
              className={`${inputClass} bg-surface-1`}
            />
          </Field>
          <Field label="Operator role">
            <PresetSelect
              name="operator_role"
              value={form.operator_role}
              onChange={set("operator_role")}
              options={OPERATOR_ROLE_OPTIONS}
              placeholder="Select operator role…"
            />
          </Field>
        </fieldset>

        {/* Description ------------------------------------------------------ */}
        <fieldset className="flex flex-col gap-4">
          <SectionTitle>About</SectionTitle>
          <Field label="Description">
            <textarea
              name="description"
              rows={3}
              value={form.description}
              onChange={(e) => set("description")(e.target.value)}
              className={`${inputClass} bg-surface-1`}
            />
          </Field>
        </fieldset>
      </AutosaveForm>

      {/* Live preview ------------------------------------------------------- */}
      <aside className="w-full shrink-0 lg:sticky lg:top-5 lg:w-72">
        <div className="rounded-2xl border border-line bg-surface-1 p-5">
          <div className="flex items-center gap-3">
            <span
              aria-hidden
              className="flex h-11 w-11 items-center justify-center rounded-xl border border-gold-500/30 bg-gold-500/10 font-display text-lg font-semibold text-gold-300"
            >
              {initial}
            </span>
            <div className="min-w-0">
              <p className="truncate font-display text-base font-semibold text-fg-primary">
                {form.name.trim() || "Your firm"}
              </p>
              {identityMeta ? (
                <p className="truncate text-xs text-fg-secondary">{identityMeta}</p>
              ) : (
                <p className="truncate text-xs text-fg-muted">Add identity details</p>
              )}
            </div>
          </div>

          <p className="mt-3 line-clamp-1 text-xs text-fg-muted">
            {firmMeta || "HQ · AUM · funds · strategy"}
          </p>

          <div className="mt-5">
            <div className="flex items-center justify-between text-[11px]">
              <span className="font-mono uppercase tracking-wider text-fg-muted">
                Completeness
              </span>
              <span className="font-mono text-fg-secondary">{completeness}%</span>
            </div>
            <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-surface-2">
              <div
                className="h-full rounded-full bg-gold-400 transition-all"
                style={{ width: `${completeness}%` }}
              />
            </div>
          </div>
        </div>
      </aside>
    </div>
  );
}
