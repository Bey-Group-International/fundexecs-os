// components/run/OnboardingSubmission.tsx
// What the LP told you in the wizard, laid out for review. Read-only. Their own
// statements, not verified facts: the checks and your decision are what verify.
import {
  ACCREDITATION_BASIS_LABEL,
  CONSENT_TEXT,
  ENTITY_TYPE_LABEL,
  LP_TYPE_LABEL,
} from "@/lib/lp-wizard";
import type { LpAccreditationBasis, LpEntityType, LpType } from "@/lib/supabase/database.types";

export interface SubmissionView {
  lpType: LpType;
  ownerThresholdPct: number;
  profile: {
    legalName: string | null;
    entityType: LpEntityType | null;
    country: string | null;
    contactPhone: string | null;
    signatoryName: string | null;
    signatoryTitle: string | null;
    sourceOfFunds: string | null;
    accreditationBasis: LpAccreditationBasis | null;
    accreditationStatedAt: string | null;
  } | null;
  owners: { id: string; fullName: string; role: "owner" | "controller"; ownershipPct: number | null; country: string | null }[];
  consents: { scope: keyof typeof CONSENT_TEXT; typedName: string; consentedAt: string }[];
}

const day = (iso: string) => new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

function Row({ k, v }: { k: string; v: string | null | undefined }) {
  return (
    <div className="grid gap-1 sm:grid-cols-[11rem_minmax(0,1fr)]">
      <dt className="font-mono text-[10px] uppercase tracking-wider text-fg-muted">{k}</dt>
      <dd className="text-sm text-fg-primary">{v || <span className="text-fg-muted">Not given</span>}</dd>
    </div>
  );
}

export function OnboardingSubmission({ view }: { view: SubmissionView }) {
  const p = view.profile;
  if (!p && view.owners.length === 0 && view.consents.length === 0) return null;

  const largeOwners = view.owners.filter((o) => o.role === "owner" && (o.ownershipPct ?? 0) >= view.ownerThresholdPct);

  return (
    <div className="rounded-lg border border-line bg-surface-0 p-3">
      <p className="text-sm font-medium text-fg-primary">What the LP submitted</p>
      <p className="mt-1 text-xs text-fg-muted">The LP&apos;s own statements. {LP_TYPE_LABEL[view.lpType]}.</p>
      <dl className="mt-3 grid gap-2">
        <Row k="Legal name" v={p?.legalName} />
        <Row k="Type" v={p?.entityType ? ENTITY_TYPE_LABEL[p.entityType] : null} />
        <Row k="Country" v={p?.country} />
        <Row k="Phone" v={p?.contactPhone} />
        {view.lpType !== "individual" ? <Row k="Signatory" v={p?.signatoryName ? `${p.signatoryName}, ${p.signatoryTitle ?? ""}` : null} /> : null}
        <Row k="How they qualify" v={p?.accreditationBasis ? `${ACCREDITATION_BASIS_LABEL[p.accreditationBasis]}${p.accreditationStatedAt ? `, stated ${day(p.accreditationStatedAt)}` : ""}` : null} />
        <Row k="Source of funds" v={p?.sourceOfFunds} />
      </dl>

      {view.lpType === "entity" ? (
        <div className="mt-3">
          <p className="font-mono text-[10px] uppercase tracking-wider text-fg-muted">Owners and control</p>
          {view.owners.length === 0 ? (
            <p className="mt-1 text-sm text-fg-muted">None listed.</p>
          ) : (
            <ul className="mt-1 grid gap-0.5">
              {view.owners.map((o) => (
                <li key={o.id} className="text-sm text-fg-primary">
                  {o.fullName} <span className="text-fg-muted">· {o.role === "controller" ? "controls" : "owner"}
                  {o.ownershipPct !== null ? ` · ${o.ownershipPct}%` : ""}
                  {o.country ? ` · ${o.country}` : ""}</span>
                </li>
              ))}
            </ul>
          )}
          {largeOwners.length === 0 ? (
            <p role="status" className="mt-1 text-xs text-amber-400">
              No one is listed as owning {view.ownerThresholdPct}% or more. Confirm that is right before approving.
            </p>
          ) : null}
        </div>
      ) : null}

      <div className="mt-3">
        <p className="font-mono text-[10px] uppercase tracking-wider text-fg-muted">Consent</p>
        {view.consents.length === 0 ? (
          <p className="mt-1 text-sm text-amber-400">No consent recorded.</p>
        ) : (
          <ul className="mt-1 grid gap-0.5">
            {view.consents.map((c, i) => (
              <li key={i} className="text-sm text-fg-primary">
                {CONSENT_TEXT[c.scope].title} <span className="text-fg-muted">· {c.typedName} · {day(c.consentedAt)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
