"use client";

import { useState } from "react";
import { createOrganization } from "./actions";

const TOTAL_STEPS = 4;

const ROLE_OPTIONS = [
  { value: "gp", label: "GP / Fund Manager", desc: "Running a fund and deploying capital" },
  { value: "family_office", label: "Family Office", desc: "Managing capital for a single family" },
  { value: "advisory", label: "Advisory / Placement", desc: "Supporting GPs or sourcing on behalf of LPs" },
  { value: "operator", label: "Operator / Co-GP", desc: "Running assets alongside a capital partner" },
];

const AUM_OPTIONS = [
  { value: "sub_25m", label: "Under $25M" },
  { value: "25m_100m", label: "$25M – $100M" },
  { value: "100m_500m", label: "$100M – $500M" },
  { value: "500m_1b", label: "$500M – $1B" },
  { value: "over_1b", label: "Over $1B" },
];

const STRATEGY_OPTIONS = [
  { value: "real_estate", label: "Real Estate", desc: "Acquisitions, development, industrial, multifamily" },
  { value: "private_equity", label: "Private Equity", desc: "Buyouts, growth equity, venture" },
  { value: "credit", label: "Private Credit", desc: "Direct lending, mezz, structured debt" },
  { value: "multi", label: "Multi-strategy", desc: "Across asset classes" },
];

const HUB_OPTIONS = [
  { value: "source", label: "Source", desc: "Deal pipeline, LP sourcing, relationships — start here if you're actively sourcing" },
  { value: "build", label: "Build", desc: "Firm identity, thesis, entity structure — start here if you're setting up a new fund" },
  { value: "run", label: "Run", desc: "Diligence, underwriting, active deals — start here if you have deals in flight" },
  { value: "execute", label: "Execute", desc: "Closing, asset management, reporting — start here if you have assets under management" },
];

interface FormData {
  org_name: string;
  entity_type: string;
  hq_location: string;
  role: string;
  aum_range: string;
  fund_count: string;
  strategy: string;
  first_hub: string;
}

export default function OnboardingWizard({ error }: { error?: string }) {
  const [step, setStep] = useState(1);
  const [pending, setPending] = useState(false);
  const [formError, setFormError] = useState(error ?? "");
  const [data, setData] = useState<FormData>({
    org_name: "",
    entity_type: "",
    hq_location: "",
    role: "",
    aum_range: "",
    fund_count: "",
    strategy: "",
    first_hub: "",
  });

  const set = (key: keyof FormData, value: string) =>
    setData((d) => ({ ...d, [key]: value }));

  const canNext = () => {
    if (step === 1) return data.org_name.trim().length > 0;
    if (step === 2) return data.role !== "";
    if (step === 3) return data.strategy !== "";
    if (step === 4) return data.first_hub !== "";
    return false;
  };

  const handleSubmit = async () => {
    setPending(true);
    setFormError("");
    const fd = new FormData();
    fd.append("name", data.org_name);
    fd.append("entity_type", data.entity_type);
    fd.append("hq_location", data.hq_location);
    fd.append("role", data.role);
    fd.append("aum_range", data.aum_range);
    fd.append("fund_count", data.fund_count);
    fd.append("strategy", data.strategy);
    fd.append("first_hub", data.first_hub);
    try {
      await createOrganization(fd);
    } catch (e: unknown) {
      setFormError(e instanceof Error ? e.message : "Something went wrong");
      setPending(false);
    }
  };

  const inputCls =
    "w-full rounded-md border border-white/10 bg-white/5 px-3 py-2.5 text-sm text-white placeholder-neutral-600 outline-none transition focus:border-agent-associate focus:bg-white/[0.07]";

  const optionCls = (selected: boolean) =>
    `cursor-pointer rounded-lg border px-4 py-3 text-left transition ${
      selected
        ? "border-agent-associate bg-agent-associate/10 text-white"
        : "border-white/10 bg-white/[0.02] text-neutral-400 hover:border-white/20 hover:bg-white/5"
    }`;

  return (
    <div className="w-full max-w-md">
      {/* Progress bar */}
      <div className="mb-8">
        <div className="mb-2 flex justify-between">
          <span className="font-mono text-xs text-neutral-600">
            Step {step} of {TOTAL_STEPS}
          </span>
          <span className="font-mono text-xs text-neutral-600">
            {Math.round((step / TOTAL_STEPS) * 100)}%
          </span>
        </div>
        <div className="h-0.5 w-full overflow-hidden rounded-full bg-white/5">
          <div
            className="h-full rounded-full bg-agent-associate transition-all duration-500"
            style={{ width: `${(step / TOTAL_STEPS) * 100}%` }}
          />
        </div>
      </div>

      {formError && (
        <p className="mb-4 rounded-md border border-red-500/20 bg-red-500/10 px-3 py-2 text-sm text-red-400">
          {formError}
        </p>
      )}

      {/* Step 1 — Org identity */}
      {step === 1 && (
        <div>
          <p className="font-mono text-xs uppercase tracking-[0.2em] text-agent-associate">
            Build · Identity
          </p>
          <h2 className="mt-2 text-2xl font-semibold tracking-tight text-white">
            Name your organization
          </h2>
          <p className="mt-1.5 text-sm text-neutral-500">
            Your GP firm, fund, or family office. Everything you build lives
            inside this organization.
          </p>
          <div className="mt-6 flex flex-col gap-3">
            <div className="flex flex-col gap-1">
              <label className="text-xs text-neutral-500">Organization name *</label>
              <input
                className={inputCls}
                placeholder="Apex Capital Partners"
                value={data.org_name}
                onChange={(e) => set("org_name", e.target.value)}
                autoFocus
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs text-neutral-500">Entity type</label>
              <input
                className={inputCls}
                placeholder="LP, LLC, GP — optional"
                value={data.entity_type}
                onChange={(e) => set("entity_type", e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs text-neutral-500">Headquarters</label>
              <input
                className={inputCls}
                placeholder="New York, NY — optional"
                value={data.hq_location}
                onChange={(e) => set("hq_location", e.target.value)}
              />
            </div>
          </div>
        </div>
      )}

      {/* Step 2 — Operator role */}
      {step === 2 && (
        <div>
          <p className="font-mono text-xs uppercase tracking-[0.2em] text-agent-associate">
            Build · Role
          </p>
          <h2 className="mt-2 text-2xl font-semibold tracking-tight text-white">
            What best describes you?
          </h2>
          <p className="mt-1.5 text-sm text-neutral-500">
            This tells the agents how to configure your workspace.
          </p>
          <div className="mt-6 flex flex-col gap-2">
            {ROLE_OPTIONS.map((r) => (
              <button
                key={r.value}
                className={optionCls(data.role === r.value)}
                onClick={() => set("role", r.value)}
                type="button"
              >
                <p className="font-medium">{r.label}</p>
                <p className="mt-0.5 text-xs opacity-60">{r.desc}</p>
              </button>
            ))}
          </div>
          <div className="mt-4 grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1">
              <label className="text-xs text-neutral-500">AUM range</label>
              <select
                className={inputCls}
                value={data.aum_range}
                onChange={(e) => set("aum_range", e.target.value)}
              >
                <option value="">Select range</option>
                {AUM_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs text-neutral-500">Active funds</label>
              <input
                className={inputCls}
                type="number"
                min="0"
                placeholder="e.g. 2"
                value={data.fund_count}
                onChange={(e) => set("fund_count", e.target.value)}
              />
            </div>
          </div>
        </div>
      )}

      {/* Step 3 — Strategy */}
      {step === 3 && (
        <div>
          <p className="font-mono text-xs uppercase tracking-[0.2em] text-agent-associate">
            Build · Strategy
          </p>
          <h2 className="mt-2 text-2xl font-semibold tracking-tight text-white">
            What is your primary strategy?
          </h2>
          <p className="mt-1.5 text-sm text-neutral-500">
            Agents will calibrate deal templates, diligence checklists, and
            underwriting models to your asset class.
          </p>
          <div className="mt-6 flex flex-col gap-2">
            {STRATEGY_OPTIONS.map((s) => (
              <button
                key={s.value}
                className={optionCls(data.strategy === s.value)}
                onClick={() => set("strategy", s.value)}
                type="button"
              >
                <p className="font-medium">{s.label}</p>
                <p className="mt-0.5 text-xs opacity-60">{s.desc}</p>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Step 4 — First hub */}
      {step === 4 && (
        <div>
          <p className="font-mono text-xs uppercase tracking-[0.2em] text-agent-associate">
            Activation
          </p>
          <h2 className="mt-2 text-2xl font-semibold tracking-tight text-white">
            Where do you want to start?
          </h2>
          <p className="mt-1.5 text-sm text-neutral-500">
            Your Associate Agent will activate this hub first. You can access
            all hubs at any time.
          </p>
          <div className="mt-6 flex flex-col gap-2">
            {HUB_OPTIONS.map((h) => (
              <button
                key={h.value}
                className={optionCls(data.first_hub === h.value)}
                onClick={() => set("first_hub", h.value)}
                type="button"
              >
                <p className="font-medium">{h.label}</p>
                <p className="mt-0.5 text-xs opacity-60">{h.desc}</p>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Nav buttons */}
      <div className="mt-8 flex items-center justify-between">
        {step > 1 ? (
          <button
            onClick={() => setStep((s) => s - 1)}
            type="button"
            className="rounded-md border border-white/10 px-4 py-2 text-sm text-neutral-400 transition hover:bg-white/5"
          >
            Back
          </button>
        ) : (
          <div />
        )}

        {step < TOTAL_STEPS ? (
          <button
            onClick={() => setStep((s) => s + 1)}
            disabled={!canNext()}
            type="button"
            className="rounded-md bg-agent-associate px-5 py-2 text-sm font-medium text-white transition hover:opacity-90 disabled:opacity-30"
          >
            Continue
          </button>
        ) : (
          <button
            onClick={handleSubmit}
            disabled={!canNext() || pending}
            type="button"
            className="rounded-md bg-agent-associate px-5 py-2 text-sm font-medium text-white transition hover:opacity-90 disabled:opacity-30"
          >
            {pending ? "Creating…" : "Launch workspace"}
          </button>
        )}
      </div>
    </div>
  );
}
