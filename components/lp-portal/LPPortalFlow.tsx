"use client";

// components/lp-portal/LPPortalFlow.tsx
// Multi-step LP onboarding portal UI. Drives the LP through:
//   pending → accreditation → subscription → committed → (operator closes → complete)
import { useState, useTransition } from "react";
import {
  submitAccreditationAction,
  signSubscriptionAction,
  confirmCapitalCommitmentAction,
} from "@/app/lp/[token]/actions";
import { buildOnboardingSteps, onboardingProgressPct, type OnboardingStatus } from "@/lib/lp-onboarding";

const ACCREDITATION_OPTIONS = [
  {
    value: "accredited_investor" as const,
    label: "Accredited Investor",
    description: "Individual with net worth > $1M (excluding primary residence) or income > $200K ($300K joint) for the past two years",
  },
  {
    value: "qualified_purchaser" as const,
    label: "Qualified Purchaser",
    description: "Individual or family-owned business with ≥ $5M in investments",
  },
  {
    value: "qualified_client" as const,
    label: "Qualified Client",
    description: "Individual with ≥ $2.2M in assets under management or ≥ $2.2M in net worth",
  },
  {
    value: "institutional" as const,
    label: "Institutional Investor",
    description: "Endowment, foundation, pension, sovereign wealth fund, or equivalent institutional entity",
  },
];

function ProgressBar({ status }: { status: OnboardingStatus }) {
  const pct = onboardingProgressPct(status);
  const steps = buildOnboardingSteps(status).filter((s) => s.key !== "pending");

  return (
    <div className="mb-8">
      <div className="mb-3 h-1.5 overflow-hidden rounded-full bg-surface-2">
        <div
          className="h-full rounded-full bg-gold-400 transition-all duration-700"
          style={{ width: `${pct}%` }}
        />
      </div>
      <div className="flex gap-4">
        {steps.map((step) => (
          <div key={step.key} className="flex-1">
            <p
              className={`font-mono text-[9px] uppercase tracking-wider truncate ${
                step.completed
                  ? "text-emerald-400"
                  : step.current
                  ? "text-gold-300"
                  : "text-fg-muted"
              }`}
            >
              {step.completed ? "✓ " : step.current ? "→ " : "○ "}
              {step.label}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}

function AccreditationStep({
  token,
  onDone,
}: {
  token: string;
  onDone: () => void;
}) {
  const [selected, setSelected] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleSubmit() {
    if (!selected) return;
    setError(null);
    startTransition(async () => {
      const result = await submitAccreditationAction(
        token,
        selected as "accredited_investor" | "qualified_purchaser" | "qualified_client" | "institutional",
      );
      if ("error" in result) {
        setError(result.error);
      } else {
        onDone();
      }
    });
  }

  return (
    <div>
      <h2 className="font-display text-xl font-semibold text-fg-primary">Investor Accreditation</h2>
      <p className="mt-1 text-sm text-fg-secondary">
        Select the category that best describes your investor status. This is required by securities law before you can invest.
      </p>

      <div className="mt-6 flex flex-col gap-3">
        {ACCREDITATION_OPTIONS.map((opt) => (
          <label
            key={opt.value}
            className={`flex cursor-pointer items-start gap-3 rounded-xl border p-4 transition ${
              selected === opt.value
                ? "border-gold-500/60 bg-gold-500/10"
                : "border-line bg-surface-1 hover:border-gold-500/30"
            }`}
          >
            <input
              type="radio"
              name="accreditation"
              value={opt.value}
              checked={selected === opt.value}
              onChange={() => setSelected(opt.value)}
              className="mt-0.5 shrink-0 accent-amber-400"
            />
            <div>
              <p className={`text-sm font-medium ${selected === opt.value ? "text-gold-300" : "text-fg-primary"}`}>
                {opt.label}
              </p>
              <p className="mt-0.5 text-xs text-fg-muted">{opt.description}</p>
            </div>
          </label>
        ))}
      </div>

      {error && <p className="mt-3 font-mono text-[11px] text-status-danger">{error}</p>}

      <p className="mt-4 text-xs text-fg-muted">
        By continuing, you confirm that the above description accurately describes your investor status. This self-certification is made under penalty of securities law.
      </p>

      <button
        onClick={handleSubmit}
        disabled={!selected || pending}
        className="mt-5 w-full rounded-lg border border-gold-500/40 bg-gold-500/10 py-2.5 font-mono text-[11px] uppercase tracking-wider text-gold-300 transition hover:bg-gold-500/20 disabled:opacity-40"
      >
        {pending ? "Saving…" : "Confirm accreditation →"}
      </button>
    </div>
  );
}

function SubscriptionStep({
  token,
  lpName,
  fundName,
  commitmentAmount,
  subscriptionContent,
  onDone,
}: {
  token: string;
  lpName: string;
  fundName: string;
  commitmentAmount: number | null;
  subscriptionContent: string;
  onDone: () => void;
}) {
  const [agreed, setAgreed] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleSign() {
    if (!agreed) return;
    setError(null);
    startTransition(async () => {
      const result = await signSubscriptionAction(token);
      if ("error" in result) {
        setError(result.error);
      } else {
        onDone();
      }
    });
  }

  return (
    <div>
      <h2 className="font-display text-xl font-semibold text-fg-primary">Subscription Agreement</h2>
      <p className="mt-1 text-sm text-fg-secondary">
        Review your subscription agreement for <strong className="text-fg-primary">{fundName}</strong>.
        {commitmentAmount
          ? ` Your commitment amount is $${Number(commitmentAmount).toLocaleString("en-US")}.`
          : ""}
      </p>

      {/* Document preview */}
      <div className="mt-5 max-h-72 overflow-y-auto rounded-xl border border-line bg-surface-2 px-5 py-4">
        <pre className="whitespace-pre-wrap font-mono text-[11px] leading-relaxed text-fg-secondary">
          {subscriptionContent ||
            `SUBSCRIPTION AGREEMENT\n\n${fundName}\n\nInvestor: ${lpName}\n\nThis subscription agreement (the "Agreement") is entered into between the above-named investor ("Investor") and the General Partner of ${fundName}.\n\nBy executing this Agreement, the Investor agrees to purchase a limited partnership interest in ${fundName} on the terms and conditions set forth in the Limited Partnership Agreement.`}
        </pre>
      </div>

      <label className="mt-4 flex items-start gap-3 cursor-pointer">
        <input
          type="checkbox"
          checked={agreed}
          onChange={(e) => setAgreed(e.target.checked)}
          className="mt-0.5 shrink-0 accent-amber-400"
        />
        <span className="text-xs text-fg-secondary">
          I, <strong className="text-fg-primary">{lpName}</strong>, have read and agree to the terms of the subscription agreement for{" "}
          <strong className="text-fg-primary">{fundName}</strong>. I understand this constitutes a legally binding commitment.
        </span>
      </label>

      {error && <p className="mt-3 font-mono text-[11px] text-status-danger">{error}</p>}

      <button
        onClick={handleSign}
        disabled={!agreed || pending}
        className="mt-5 w-full rounded-lg border border-gold-500/40 bg-gold-500/10 py-2.5 font-mono text-[11px] uppercase tracking-wider text-gold-300 transition hover:bg-gold-500/20 disabled:opacity-40"
      >
        {pending ? "Signing…" : "✍ Sign subscription agreement →"}
      </button>
    </div>
  );
}

function WireStep({
  token,
  fundName,
  commitmentAmount,
  wireInstructions,
  onDone,
}: {
  token: string;
  fundName: string;
  commitmentAmount: number | null;
  wireInstructions: Record<string, string>;
  onDone: () => void;
}) {
  const [confirmed, setConfirmed] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const hasWireDetails = Object.keys(wireInstructions).length > 0;

  const defaultWire: Record<string, string> = {
    "Bank Name": wireInstructions.bank_name ?? "Contact your fund administrator",
    "Account Name": wireInstructions.account_name ?? "—",
    "Account Number": wireInstructions.account_number ?? "—",
    "Routing / ABA": wireInstructions.routing_number ?? "—",
    "Reference": wireInstructions.reference ?? `${fundName} Capital Call`,
  };

  function handleConfirm() {
    if (!confirmed) return;
    setError(null);
    startTransition(async () => {
      const result = await confirmCapitalCommitmentAction(token);
      if ("error" in result) {
        setError(result.error);
      } else {
        onDone();
      }
    });
  }

  return (
    <div>
      <h2 className="font-display text-xl font-semibold text-fg-primary">Wire Instructions</h2>
      <p className="mt-1 text-sm text-fg-secondary">
        Use the details below to initiate your capital transfer to{" "}
        <strong className="text-fg-primary">{fundName}</strong>.
        {commitmentAmount
          ? ` Amount due: $${Number(commitmentAmount).toLocaleString("en-US")}.`
          : ""}
      </p>

      <div className="mt-5 overflow-hidden rounded-xl border border-line bg-surface-1">
        {Object.entries(defaultWire).map(([key, value], i) => (
          <div
            key={key}
            className={`flex items-center justify-between gap-4 px-4 py-3 ${i > 0 ? "border-t border-line/50" : ""}`}
          >
            <span className="font-mono text-[10px] uppercase tracking-wider text-fg-muted">{key}</span>
            <span className="font-mono text-sm text-fg-primary">{value}</span>
          </div>
        ))}
      </div>

      {!hasWireDetails && (
        <p className="mt-3 rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2 font-mono text-[10px] text-amber-400">
          Your fund manager will send final wire details directly. Confirm below once you have initiated the transfer.
        </p>
      )}

      <label className="mt-4 flex items-start gap-3 cursor-pointer">
        <input
          type="checkbox"
          checked={confirmed}
          onChange={(e) => setConfirmed(e.target.checked)}
          className="mt-0.5 shrink-0 accent-amber-400"
        />
        <span className="text-xs text-fg-secondary">
          I confirm I have initiated or will initiate a wire transfer of my committed capital to{" "}
          <strong className="text-fg-primary">{fundName}</strong>.
        </span>
      </label>

      {error && <p className="mt-3 font-mono text-[11px] text-status-danger">{error}</p>}

      <button
        onClick={handleConfirm}
        disabled={!confirmed || pending}
        className="mt-5 w-full rounded-lg border border-gold-500/40 bg-gold-500/10 py-2.5 font-mono text-[11px] uppercase tracking-wider text-gold-300 transition hover:bg-gold-500/20 disabled:opacity-40"
      >
        {pending ? "Saving…" : "Confirm capital commitment →"}
      </button>
    </div>
  );
}

function CommittedScreen({ fundName }: { fundName: string }) {
  return (
    <div className="flex flex-col items-center py-8 text-center">
      <span className="mb-4 flex h-14 w-14 items-center justify-center rounded-full border border-emerald-500/40 bg-emerald-500/10 text-2xl">
        ✓
      </span>
      <h2 className="font-display text-xl font-semibold text-fg-primary">You&apos;re committed</h2>
      <p className="mt-2 max-w-sm text-sm text-fg-secondary">
        Your capital commitment to <strong className="text-fg-primary">{fundName}</strong> has been recorded.
        The fund manager will confirm receipt of your wire and complete your onboarding.
      </p>
      <p className="mt-4 font-mono text-[10px] uppercase tracking-wider text-emerald-400/60">
        Awaiting capital confirmation
      </p>
    </div>
  );
}

export interface LPPortalFlowProps {
  token: string;
  initialStatus: OnboardingStatus;
  lpName: string;
  fundName: string;
  commitmentAmount: number | null;
  wireInstructions: Record<string, string>;
  subscriptionContent: string;
}

export function LPPortalFlow({
  token,
  initialStatus,
  lpName,
  fundName,
  commitmentAmount,
  wireInstructions,
  subscriptionContent,
}: LPPortalFlowProps) {
  const [status, setStatus] = useState<OnboardingStatus>(initialStatus);

  function advance(next: OnboardingStatus) {
    setStatus(next);
  }

  return (
    <div>
      <ProgressBar status={status} />

      {status === "pending" && (
        <AccreditationStep token={token} onDone={() => advance("accreditation")} />
      )}

      {status === "accreditation" && (
        <SubscriptionStep
          token={token}
          lpName={lpName}
          fundName={fundName}
          commitmentAmount={commitmentAmount}
          subscriptionContent={subscriptionContent}
          onDone={() => advance("subscription")}
        />
      )}

      {status === "subscription" && (
        <WireStep
          token={token}
          fundName={fundName}
          commitmentAmount={commitmentAmount}
          wireInstructions={wireInstructions}
          onDone={() => advance("committed")}
        />
      )}

      {(status === "committed" || status === "complete") && (
        <CommittedScreen fundName={fundName} />
      )}
    </div>
  );
}
