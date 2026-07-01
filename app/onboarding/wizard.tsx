"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { ActionKind } from "@/lib/gates";
import { MANDATE_ACTION_OPTIONS } from "@/lib/mandate-options";
import { createOrganization, updateUserProfile } from "./actions";

const TOTAL_STEPS = 6;

// Autonomy presets for the optional final step. Each maps to a mandate shape:
// an autonomy ceiling (1 = draft only, 2 = act within mandate) and the Tier-2
// actions to pre-authorize. "Custom" carries no fixed shape — the operator
// expands the per-action toggles below.
type MandatePreset = "draft" | "routine" | "custom";

// The sensible Tier-2 subset for the "routine" preset: counterparty outreach
// and LP/stakeholder reporting. Filtered through the catalog so a reclassified
// kind can never leak in.
const ROUTINE_ACTIONS: ActionKind[] = (
  ["send_outreach", "distribute_report"] as ActionKind[]
).filter((k) => MANDATE_ACTION_OPTIONS.some((o) => o.kind === k));

const MANDATE_PRESETS: {
  value: MandatePreset;
  label: string;
  desc: string;
}[] = [
  {
    value: "draft",
    label: "Draft only — I approve everything",
    desc: "Earn prepares every outreach, report, and memo, then holds at the line. You press send.",
  },
  {
    value: "routine",
    label: "Let Earn handle routine outreach & reports",
    desc: "Earn sends prospect outreach and distributes reports on its own. Everything else still waits for you.",
  },
  {
    value: "custom",
    label: "Custom",
    desc: "Pick exactly which counterparty-facing actions Earn may run unattended.",
  },
];

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

interface OrgFormData {
  org_name: string;
  entity_type: string;
  hq_location: string;
  role: string;
  aum_range: string;
  fund_count: string;
  strategy: string;
  first_hub: string;
}

interface UserFormData {
  full_name: string;
  title: string;
  phone: string;
  avatar_url: string;
}

export default function OnboardingWizard({
  error,
  initialFullName,
  userEmail,
}: {
  error?: string;
  initialFullName?: string;
  userEmail?: string;
}) {
  const router = useRouter();
  const [step, setStep] = useState(1);
  const [pending, setPending] = useState(false);
  const [formError, setFormError] = useState(error ?? "");
  const [userData, setUserData] = useState<UserFormData>({
    full_name: initialFullName ?? "",
    title: "",
    phone: "",
    avatar_url: "",
  });
  const [data, setData] = useState<OrgFormData>({
    org_name: "",
    entity_type: "",
    hq_location: "",
    role: "",
    aum_range: "",
    fund_count: "",
    strategy: "",
    first_hub: "",
  });

  const setUser = (key: keyof UserFormData, value: string) =>
    setUserData((d) => ({ ...d, [key]: value }));

  // Mandate step state. Defaults to the conservative "draft only" posture, so
  // the step is always satisfiable and skippable.
  const [preset, setPreset] = useState<MandatePreset>("draft");
  const [customActions, setCustomActions] = useState<Set<ActionKind>>(new Set());

  const set = (key: keyof FormData, value: string) =>
    setData((d) => ({ ...d, [key]: value }));

  const toggleCustomAction = (kind: ActionKind) =>
    setCustomActions((prev) => {
      const next = new Set(prev);
      if (next.has(kind)) next.delete(kind);
      else next.add(kind);
      return next;
    });

  // Resolve the chosen posture into the mandate shape to persist.
  const resolveMandate = (
    which: MandatePreset = preset,
  ): { ceiling: 1 | 2; actions: ActionKind[] } => {
    if (which === "draft") return { ceiling: 1, actions: [] };
    if (which === "routine") return { ceiling: 2, actions: ROUTINE_ACTIONS };
    const actions = [...customActions];
    // Custom with nothing toggled is functionally draft-only; keep ceiling at 1.
    return { ceiling: actions.length > 0 ? 2 : 1, actions };
  };

  const canNext = () => {
    if (step === 1) return userData.full_name.trim().length > 0;
    if (step === 2) return data.org_name.trim().length > 0;
    if (step === 3) return data.role !== "";
    if (step === 4) return data.strategy !== "";
    if (step === 5) return data.first_hub !== "";
    if (step === 6) return true; // Optional — a posture is always preselected.
    return false;
  };

  // `presetOverride` lets "Skip" persist the conservative default regardless of
  // any preset the operator may have clicked, without waiting for a state flush.
  const handleSubmit = async (presetOverride?: MandatePreset) => {
    setPending(true);
    setFormError("");

    // Persist user profile first (non-blocking failure is surfaced but doesn't
    // block org creation — the org is the gate to the workspace).
    const ufd = new FormData();
    ufd.append("full_name", userData.full_name);
    ufd.append("title", userData.title);
    ufd.append("phone", userData.phone);
    ufd.append("avatar_url", userData.avatar_url);
    const userResult = await updateUserProfile(ufd);
    if (userResult?.error) {
      setFormError(userResult.error);
      setPending(false);
      return;
    }

    const fd = new FormData();
    fd.append("name", data.org_name);
    fd.append("entity_type", data.entity_type);
    fd.append("hq_location", data.hq_location);
    fd.append("role", data.role);
    fd.append("aum_range", data.aum_range);
    fd.append("fund_count", data.fund_count);
    fd.append("strategy", data.strategy);
    fd.append("first_hub", data.first_hub);
    const mandate = resolveMandate(presetOverride);
    fd.append("autonomy_ceiling", String(mandate.ceiling));
    for (const action of mandate.actions) fd.append("auto_approve", action);
    try {
      const result = await createOrganization(fd);
      if (result?.error) {
        setFormError(result.error);
        setPending(false);
        return;
      }
      router.replace("/workspace");
    } catch (e: unknown) {
      setFormError(e instanceof Error ? e.message : "Something went wrong");
      setPending(false);
    }
  };

  const inputCls =
    "w-full rounded-md border border-line bg-surface-2 px-3 py-2.5 text-sm text-fg-primary placeholder-fg-muted outline-none transition focus:border-gold-500 focus:bg-surface-2";

  const optionCls = (selected: boolean) =>
    `cursor-pointer rounded-lg border px-4 py-3 text-left transition ${
      selected
        ? "border-gold-500 bg-gold-400/10 text-fg-primary"
        : "border-line bg-surface-1 text-fg-secondary hover:border-gold-500/40 hover:bg-surface-2"
    }`;

  return (
    <div className="w-full max-w-md">
      {/* Progress bar */}
      <div className="mb-8">
        <div className="mb-2 flex justify-between">
          <span className="font-mono text-xs text-fg-muted">
            Step {step} of {TOTAL_STEPS}
          </span>
          <span className="font-mono text-xs text-fg-muted">
            {Math.round((step / TOTAL_STEPS) * 100)}%
          </span>
        </div>
        <div className="h-0.5 w-full overflow-hidden rounded-full bg-surface-2">
          <div
            className="h-full rounded-full bg-gold-400 transition-all duration-500"
            style={{ width: `${(step / TOTAL_STEPS) * 100}%` }}
          />
        </div>
      </div>

      {formError && (
        <p className="mb-4 rounded-md border border-red-500/20 bg-red-500/10 px-3 py-2 text-sm text-red-400">
          {formError}
        </p>
      )}

      {/* Step 1 — User profile */}
      {step === 1 && (
        <div>
          <p className="font-mono text-xs uppercase tracking-[0.2em] text-gold-400">
            Your profile
          </p>
          <h2 className="mt-2 text-2xl font-semibold tracking-tight text-fg-primary">
            Tell us about yourself
          </h2>
          <p className="mt-1.5 text-sm text-fg-secondary">
            Your personal profile — separate from your firm. This is how
            counterparties and teammates will see you.
          </p>
          <div className="mt-6 flex flex-col gap-3">
            {userEmail && (
              <div className="flex flex-col gap-1">
                <label className="text-xs text-fg-secondary">Email</label>
                <input
                  className={`${inputCls} opacity-60`}
                  value={userEmail}
                  readOnly
                  tabIndex={-1}
                />
              </div>
            )}
            <div className="flex flex-col gap-1">
              <label className="text-xs text-fg-secondary">Full name *</label>
              <input
                className={inputCls}
                placeholder="Jordan Smith"
                value={userData.full_name}
                onChange={(e) => setUser("full_name", e.target.value)}
                autoFocus
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs text-fg-secondary">Title</label>
              <input
                className={inputCls}
                placeholder="Managing Partner — optional"
                value={userData.title}
                onChange={(e) => setUser("title", e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs text-fg-secondary">Phone</label>
              <input
                className={inputCls}
                type="tel"
                placeholder="+1 (555) 000-0000 — optional"
                value={userData.phone}
                onChange={(e) => setUser("phone", e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs text-fg-secondary">Profile photo URL</label>
              <input
                className={inputCls}
                type="url"
                placeholder="https://… — optional"
                value={userData.avatar_url}
                onChange={(e) => setUser("avatar_url", e.target.value)}
              />
            </div>
          </div>
        </div>
      )}

      {/* Step 2 — Org identity */}
      {step === 2 && (
        <div>
          <p className="font-mono text-xs uppercase tracking-[0.2em] text-gold-400">
            Build · Identity
          </p>
          <h2 className="mt-2 text-2xl font-semibold tracking-tight text-fg-primary">
            Name your organization
          </h2>
          <p className="mt-1.5 text-sm text-fg-secondary">
            Your GP firm, fund, or family office. Everything you build lives
            inside this organization.
          </p>
          <div className="mt-6 flex flex-col gap-3">
            <div className="flex flex-col gap-1">
              <label className="text-xs text-fg-secondary">Organization name *</label>
              <input
                className={inputCls}
                placeholder="Apex Capital Partners"
                value={data.org_name}
                onChange={(e) => set("org_name", e.target.value)}
                autoFocus
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs text-fg-secondary">Entity type</label>
              <input
                className={inputCls}
                placeholder="LP, LLC, GP — optional"
                value={data.entity_type}
                onChange={(e) => set("entity_type", e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs text-fg-secondary">Headquarters</label>
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

      {/* Step 3 — Operator role */}
      {step === 3 && (
        <div>
          <p className="font-mono text-xs uppercase tracking-[0.2em] text-gold-400">
            Build · Role
          </p>
          <h2 className="mt-2 text-2xl font-semibold tracking-tight text-fg-primary">
            What best describes you?
          </h2>
          <p className="mt-1.5 text-sm text-fg-secondary">
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
              <label className="text-xs text-fg-secondary">AUM range</label>
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
              <label className="text-xs text-fg-secondary">Active funds</label>
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

      {/* Step 4 — Strategy */}
      {step === 4 && (
        <div>
          <p className="font-mono text-xs uppercase tracking-[0.2em] text-gold-400">
            Build · Strategy
          </p>
          <h2 className="mt-2 text-2xl font-semibold tracking-tight text-fg-primary">
            What is your primary strategy?
          </h2>
          <p className="mt-1.5 text-sm text-fg-secondary">
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

      {/* Step 5 — First hub */}
      {step === 5 && (
        <div>
          <p className="font-mono text-xs uppercase tracking-[0.2em] text-gold-400">
            Activation
          </p>
          <h2 className="mt-2 text-2xl font-semibold tracking-tight text-fg-primary">
            Where do you want to start?
          </h2>
          <p className="mt-1.5 text-sm text-fg-secondary">
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

      {/* Step 6 — Mandate (optional) */}
      {step === 6 && (
        <div>
          <p className="font-mono text-xs uppercase tracking-[0.2em] text-gold-400">
            Activation · Mandate
          </p>
          <h2 className="mt-2 text-2xl font-semibold tracking-tight text-fg-primary">
            What can Earn do for you?
          </h2>
          <p className="mt-1.5 text-sm text-fg-secondary">
            Set how far your Earn copilot may go on its own. You can change this
            anytime in settings — skip for now if you&apos;re not sure.
          </p>

          <div className="mt-6 flex flex-col gap-2">
            {MANDATE_PRESETS.map((p) => (
              <button
                key={p.value}
                className={optionCls(preset === p.value)}
                onClick={() => setPreset(p.value)}
                type="button"
              >
                <p className="font-medium">{p.label}</p>
                <p className="mt-0.5 text-xs opacity-60">{p.desc}</p>
              </button>
            ))}
          </div>

          {/* Custom per-action toggles */}
          {preset === "custom" && (
            <div className="mt-4 flex flex-col gap-2">
              <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-fg-muted">
                External actions Earn may run
              </p>
              {MANDATE_ACTION_OPTIONS.map((opt) => {
                const on = customActions.has(opt.kind);
                return (
                  <label
                    key={opt.kind}
                    className={`flex cursor-pointer items-start gap-3 rounded-lg border px-3.5 py-3 transition ${
                      on
                        ? "border-gold-500 bg-gold-400/10"
                        : "border-line bg-surface-1 hover:border-gold-500/40 hover:bg-surface-2"
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={on}
                      onChange={() => toggleCustomAction(opt.kind)}
                      className="sr-only"
                    />
                    <span
                      className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border ${
                        on ? "border-gold-400 bg-gold-400/20" : "border-line"
                      }`}
                      aria-hidden
                    >
                      {on ? (
                        <svg viewBox="0 0 12 12" className="h-3 w-3 text-gold-300" fill="none">
                          <path
                            d="M2.5 6.2 4.8 8.5 9.5 3.5"
                            stroke="currentColor"
                            strokeWidth="1.6"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          />
                        </svg>
                      ) : null}
                    </span>
                    <span className="min-w-0">
                      <span className="block text-sm font-medium text-fg-primary">
                        {opt.label}
                      </span>
                      <span className="mt-0.5 block text-xs leading-snug text-fg-secondary">
                        {opt.description}
                      </span>
                    </span>
                  </label>
                );
              })}
            </div>
          )}

          <p className="mt-4 rounded-lg border border-line bg-surface-1 px-3 py-2.5 text-xs leading-snug text-fg-secondary">
            <span className="font-medium text-fg-primary">Capital &amp; compliance always need you.</span>{" "}
            Signing, term sheets, capital calls, and moving money are never
            delegable — Earn always stops for your sign-off.
          </p>
        </div>
      )}

      {/* Nav buttons */}
      <div className="mt-8 flex items-center justify-between">
        {step > 1 ? (
          <button
            onClick={() => setStep((s) => s - 1)}
            type="button"
            className="rounded-md border border-line px-4 py-2 text-sm text-fg-secondary transition hover:bg-surface-2"
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
            className="rounded-md bg-gold-400 px-5 py-2 text-sm font-medium text-surface-0 transition hover:opacity-90 disabled:opacity-30"
          >
            Continue
          </button>
        ) : (
          <div className="flex items-center gap-3">
            <button
              onClick={() => handleSubmit("draft")}
              disabled={pending}
              type="button"
              className="text-sm text-fg-muted underline-offset-4 transition hover:text-fg-secondary hover:underline disabled:opacity-30"
            >
              Skip for now
            </button>
            <button
              onClick={() => handleSubmit()}
              disabled={!canNext() || pending}
              type="button"
              className="rounded-md bg-gold-400 px-5 py-2 text-sm font-medium text-surface-0 transition hover:opacity-90 disabled:opacity-30"
            >
              {pending ? "Creating…" : "Launch workspace"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
