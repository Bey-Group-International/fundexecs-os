"use client";

import { useMemo, useState } from "react";
import { AutosaveForm } from "@/components/build/AutosaveForm";
import { inputClass } from "@/components/build/DraftWithEarn";

// Values mirrored from the `organizations` row this form edits.
export type ProfileValues = {
  name: string;
  legal_name: string;
  entity_type: string;
  tagline: string;
  jurisdiction: string;
  website: string;
  description: string;
  hq_location: string;
  aum_range: string;
  fund_count: string;
  primary_strategy: string;
  operator_role: string;
};

type SelectOption = { value: string; label: string };

const ENTITY_TYPE_OPTIONS: SelectOption[] = [
  { value: "LLC", label: "LLC" },
  { value: "LP", label: "LP" },
  { value: "LLP", label: "LLP" },
  { value: "Inc.", label: "Inc." },
  { value: "GP/LP", label: "GP/LP" },
  { value: "Other", label: "Other" },
];
const AUM_RANGE_OPTIONS: SelectOption[] = [
  { value: "sub_25m", label: "Under $25M" },
  { value: "25m_100m", label: "$25M \u2013 $100M" },
  { value: "100m_500m", label: "$100M \u2013 $500M" },
  { value: "500m_1b", label: "$500M \u2013 $1B" },
  { value: "over_1b", label: "Over $1B" },
];
const OPERATOR_ROLE_OPTIONS: SelectOption[] = [
  { value: "gp", label: "GP / Fund Manager" },
  { value: "family_office", label: "Family Office" },
  { value: "advisory", label: "Advisor" },
  { value: "lp", label: "Allocator / LP" },
  { value: "sponsor", label: "Sponsor" },
  { value: "placement_agent", label: "Placement Agent" },
  { value: "fund_administrator", label: "Fund Administrator" },
  { value: "ria", label: "RIA" },
  { value: "operator", label: "Operator" },
  { value: "other", label: "Other" },
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
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1.5 text-sm">
      <span className="flex items-center gap-1.5 text-fg-secondary">
        {label}
        {hint && (
          <span className="font-mono text-[9px] uppercase tracking-wider text-gold-400">
            {hint}
          </span>
        )}
      </span>
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
  options: SelectOption[];
  placeholder: string;
}) {
  const hasCustom = value !== "" && !options.some((o) => o.value === value);
  return (
    <select
      name={name}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={`${inputClass} bg-surface-1`}
    >
      <option value="">{placeholder}</option>
      {options.map((opt) => (
        <option key={opt.value} value={opt.value}>
          {opt.label}
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
    .join(" \u00b7 ");

  const firmMeta = [
    form.hq_location.trim(),
    form.aum_range.trim() ? `AUM ${form.aum_range.trim()}` : "",
    form.fund_count.trim()
      ? `${form.fund_count.trim()} fund${form.fund_count.trim() === "1" ? "" : "s"}`
      : "",
    form.primary_strategy.trim(),
  ]
    .filter(Boolean)
    .join(" \u00b7 ");

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
          <Field label="Entity type" hint="required for Earn">
            <PresetSelect
              name="entity_type"
              value={form.entity_type}
              onChange={set("entity_type")}
              options={ENTITY_TYPE_OPTIONS}
              placeholder="Select entity type\u2026"
            />
          </Field>
          <Field label="Tagline" hint="shown on profile card">
            <input
              name="tagline"
              value={form.tagline}
              onChange={(e) => set("tagline")(e.target.value)}
              maxLength={120}
              placeholder="e.g., Institutional capital for tomorrow's infrastructure"
              className={`${inputClass} bg-surface-1`}
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
              placeholder="Select AUM range\u2026"
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
          <Field label="Primary strategy" hint="required for Earn">
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
              placeholder="Select operator role\u2026"
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

          {form.tagline.trim() ? (
            <p className="mt-2 text-sm font-medium text-fg-primary">{form.tagline.trim()}</p>
          ) : null}
          <p className="mt-1.5 line-clamp-1 text-xs text-fg-muted">
            {firmMeta || "HQ \u00b7 AUM \u00b7 funds \u00b7 strategy"}
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
