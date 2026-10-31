"use client";

// components/lp-portal/LPWizard.tsx
// The LP's setup wizard: their details, owners (entities only), consent to
// screening, how they qualify and where the money comes from, then submit. Each
// step is saved as the LP goes, so they can stop and return through the same
// link. Submitting hands the file to the fund manager; nothing here approves anyone.
import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  checkIdentityAction,
  grantConsentAction,
  saveAccreditationAction,
  saveDetailsAction,
  saveOwnersAction,
  startIdentityAction,
  submitWizardAction,
} from "@/app/lp/[token]/wizard-actions";
import {
  ACCREDITATION_BASIS_LABEL,
  CONSENT_SCOPES,
  CONSENT_TEXT,
  CONSENT_TEXT_VERSION,
  ENTITY_TYPES_BY_LP_TYPE,
  ENTITY_TYPE_LABEL,
  MAX_OWNERS,
  SOURCE_OF_FUNDS_MAX,
  STEP_LABEL,
  incompleteSteps,
  stepsFor,
  type ConsentScope,
  type WizardStepKey,
} from "@/lib/lp-wizard";
import { goTo } from "@/lib/browser-navigate";
import type { IdentityState } from "@/lib/lp-identity";
import type { LpAccreditationBasis, LpEntityType, LpType } from "@/lib/supabase/database.types";

export interface WizardOwner {
  fullName: string;
  role: "owner" | "controller";
  ownershipPct: string;
  country: string;
}

export interface WizardConsent {
  scope: ConsentScope;
  textVersion: string;
  typedName: string;
  consentedAt: string;
}

export interface WizardInitial {
  legalName: string;
  entityType: LpEntityType | "";
  country: string;
  contactPhone: string;
  signatoryName: string;
  signatoryTitle: string;
  sourceOfFunds: string;
  accreditationBasis: LpAccreditationBasis | "";
  accreditationStated: boolean;
  owners: WizardOwner[];
  consents: WizardConsent[];
}

const field =
  "w-full rounded-lg border border-line bg-surface-1 px-3 py-2 text-sm text-fg-primary placeholder:text-fg-muted focus:border-gold-500/60 focus:outline-none";
const label = "font-mono text-[10px] uppercase tracking-wider text-fg-muted";
const primary =
  "rounded-lg border border-gold-500/40 bg-gold-500/10 px-4 py-2 font-mono text-[11px] uppercase tracking-wider text-gold-300 transition hover:bg-gold-500/20 disabled:opacity-50";
const quiet = "text-xs text-fg-muted hover:text-fg-secondary disabled:opacity-50";

type Result = { ok: true } | { ok: false; error: string };

export function LPWizard({
  token,
  lpType,
  ownerThresholdPct,
  changesRequested,
  identity,
  initial,
}: {
  token: string;
  lpType: LpType;
  ownerThresholdPct: number;
  changesRequested: boolean;
  /** Whether online ID verification is set up, and where this LP's verification stands. */
  identity: { enabled: boolean; state: IdentityState };
  initial: WizardInitial;
}) {
  const router = useRouter();
  const steps = stepsFor(lpType, identity.enabled);

  const [data, setData] = useState(initial);
  const [idState, setIdState] = useState<IdentityState>(identity.state);
  const missingNow = (d: WizardInitial, idVerified: boolean) =>
    incompleteSteps({
      identity: { enabled: identity.enabled, verified: idVerified },
      lpType,
      profile: {
        legal_name: d.legalName || null,
        entity_type: (d.entityType || null) as LpEntityType | null,
        country: d.country || null,
        signatory_name: d.signatoryName || null,
        signatory_title: d.signatoryTitle || null,
        source_of_funds: d.sourceOfFunds || null,
        accreditation_basis: (d.accreditationBasis || null) as LpAccreditationBasis | null,
        accreditation_statement_at: d.accreditationStated ? "set" : null,
      },
      owners: d.owners.map((o) => ({ role: o.role })),
      consents: d.consents.map((c) => ({ scope: c.scope, text_version: c.textVersion })),
    });

  const firstOpen = steps.find((s) => s !== "review" && missingNow(initial, identity.state === "verified").includes(s)) ?? "review";
  const [step, setStep] = useState<WizardStepKey>(firstOpen);
  const missing = missingNow(data, idState === "verified");
  const next = () => setStep(steps[Math.min(steps.indexOf(step) + 1, steps.length - 1)]);

  return (
    <div>
      {changesRequested ? (
        <p role="status" className="mb-4 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-300">
          Your fund manager asked for more information. Review your answers, update what&apos;s needed, and submit again.
        </p>
      ) : null}

      <ol className="mb-6 flex flex-wrap gap-2" aria-label="Steps">
        {steps.map((s) => {
          const done = s !== "review" && !missing.includes(s);
          return (
            <li key={s}>
              <button
                type="button"
                onClick={() => setStep(s)}
                aria-current={step === s ? "step" : undefined}
                className={`rounded-full border px-3 py-1 font-mono text-[11px] uppercase tracking-wider transition ${
                  step === s
                    ? "border-gold-500/50 bg-gold-500/10 text-gold-300"
                    : done
                      ? "border-emerald-500/30 text-emerald-300"
                      : "border-line text-fg-muted hover:text-fg-secondary"
                }`}
              >
                {done ? "✓ " : ""}
                {STEP_LABEL[s]}
              </button>
            </li>
          );
        })}
      </ol>

      {step === "details" ? <DetailsStep token={token} lpType={lpType} data={data} onSaved={(d) => { setData(d); next(); }} /> : null}
      {step === "owners" ? <OwnersStep token={token} thresholdPct={ownerThresholdPct} data={data} onSaved={(d) => { setData(d); next(); }} /> : null}
      {step === "consent" ? <ConsentStep token={token} data={data} onChange={setData} onContinue={next} /> : null}
      {step === "identity" ? (
        <IdentityStep
          token={token}
          lpType={lpType}
          state={idState}
          returning={identity.state !== "none" && identity.state !== "verified"}
          onState={setIdState}
          onContinue={next}
        />
      ) : null}
      {step === "accreditation" ? <AccreditationStep token={token} data={data} onSaved={(d) => { setData(d); next(); }} /> : null}
      {step === "review" ? (
        <ReviewStep
          token={token}
          missing={missing}
          goTo={setStep}
          onSubmitted={() => router.refresh()}
        />
      ) : null}
    </div>
  );
}

// ---- shared bits -----------------------------------------------------------

function useSave() {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const run = (work: () => Promise<Result>, onOk: () => void) =>
    startTransition(async () => {
      setError(null);
      const res = await work().catch(() => ({ ok: false as const, error: "Something went wrong. Try again." }));
      if (!res.ok) return setError(res.error);
      onOk();
    });
  return { error, pending, run };
}

function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-line bg-surface-1 p-5">
      <h2 className="font-display text-lg font-semibold text-fg-primary">{title}</h2>
      {hint ? <p className="mt-1 text-sm text-fg-secondary">{hint}</p> : null}
      <div className="mt-4 grid gap-4">{children}</div>
    </section>
  );
}

function ErrorLine({ error }: { error: string | null }) {
  return error ? (
    <p role="alert" className="text-sm text-amber-400">
      {error}
    </p>
  ) : null;
}

// ---- steps -----------------------------------------------------------------

function DetailsStep({ token, lpType, data, onSaved }: { token: string; lpType: LpType; data: WizardInitial; onSaved: (d: WizardInitial) => void }) {
  const [f, setF] = useState(data);
  const { error, pending, run } = useSave();
  const types = ENTITY_TYPES_BY_LP_TYPE[lpType];
  const needsSignatory = lpType !== "individual";

  return (
    <Section title="Your details" hint={lpType === "individual" ? "Who you are, as it appears on your ID." : "The investing entity, and the person who signs for it."}>
      <label className="block">
        <span className={label}>{lpType === "individual" ? "Full legal name" : "Entity legal name"}</span>
        <input aria-label="Legal name" value={f.legalName} maxLength={200} onChange={(e) => setF({ ...f, legalName: e.target.value })} className={`${field} mt-1`} />
      </label>
      <label className="block">
        <span className={label}>{lpType === "individual" ? "Investor type" : "Kind of entity"}</span>
        <select aria-label="Investor type" value={f.entityType} onChange={(e) => setF({ ...f, entityType: e.target.value as LpEntityType })} className={`${field} mt-1`}>
          <option value="">Choose…</option>
          {types.map((t) => (
            <option key={t} value={t}>
              {ENTITY_TYPE_LABEL[t]}
            </option>
          ))}
        </select>
      </label>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block">
          <span className={label}>Country</span>
          <input aria-label="Country" value={f.country} maxLength={100} onChange={(e) => setF({ ...f, country: e.target.value })} className={`${field} mt-1`} />
        </label>
        <label className="block">
          <span className={label}>Phone (optional)</span>
          <input aria-label="Phone" value={f.contactPhone} maxLength={40} onChange={(e) => setF({ ...f, contactPhone: e.target.value })} className={`${field} mt-1`} />
        </label>
      </div>
      {needsSignatory ? (
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block">
            <span className={label}>Authorized signatory</span>
            <input aria-label="Signatory name" value={f.signatoryName} maxLength={200} onChange={(e) => setF({ ...f, signatoryName: e.target.value })} className={`${field} mt-1`} />
          </label>
          <label className="block">
            <span className={label}>Signatory&apos;s title</span>
            <input aria-label="Signatory title" value={f.signatoryTitle} maxLength={100} onChange={(e) => setF({ ...f, signatoryTitle: e.target.value })} className={`${field} mt-1`} />
          </label>
        </div>
      ) : null}
      <ErrorLine error={error} />
      <div>
        <button
          type="button"
          disabled={pending}
          className={primary}
          onClick={() =>
            run(
              () =>
                saveDetailsAction(token, {
                  legalName: f.legalName,
                  entityType: f.entityType,
                  country: f.country,
                  contactPhone: f.contactPhone,
                  signatoryName: f.signatoryName,
                  signatoryTitle: f.signatoryTitle,
                }),
              () => onSaved(f),
            )
          }
        >
          {pending ? "Saving…" : "Save and continue"}
        </button>
      </div>
    </Section>
  );
}

function OwnersStep({ token, thresholdPct, data, onSaved }: { token: string; thresholdPct: number; data: WizardInitial; onSaved: (d: WizardInitial) => void }) {
  const [owners, setOwners] = useState<WizardOwner[]>(data.owners.length ? data.owners : [{ fullName: "", role: "controller", ownershipPct: "", country: "" }]);
  const { error, pending, run } = useSave();
  const update = (i: number, patch: Partial<WizardOwner>) => setOwners(owners.map((o, j) => (j === i ? { ...o, ...patch } : o)));

  return (
    <Section
      title="Owners and control"
      hint={`List everyone who owns ${thresholdPct}% or more of the entity, and at least one person who controls it (for example a manager, trustee or officer).`}
    >
      {owners.map((o, i) => (
        <div key={i} className="grid gap-2 rounded-lg border border-line bg-surface-0 p-3 sm:grid-cols-[minmax(0,1fr)_9rem_6rem_9rem_auto] sm:items-end">
          <label className="block">
            <span className={label}>Full name</span>
            <input aria-label={`Person ${i + 1} name`} value={o.fullName} maxLength={200} onChange={(e) => update(i, { fullName: e.target.value })} className={`${field} mt-1`} />
          </label>
          <label className="block">
            <span className={label}>Role</span>
            <select aria-label={`Person ${i + 1} role`} value={o.role} onChange={(e) => update(i, { role: e.target.value as WizardOwner["role"] })} className={`${field} mt-1`}>
              <option value="controller">Controls it</option>
              <option value="owner">Owns {thresholdPct}%+</option>
            </select>
          </label>
          <label className="block">
            <span className={label}>Share %</span>
            <input aria-label={`Person ${i + 1} share`} inputMode="decimal" value={o.ownershipPct} onChange={(e) => update(i, { ownershipPct: e.target.value })} className={`${field} mt-1`} />
          </label>
          <label className="block">
            <span className={label}>Country</span>
            <input aria-label={`Person ${i + 1} country`} value={o.country} maxLength={100} onChange={(e) => update(i, { country: e.target.value })} className={`${field} mt-1`} />
          </label>
          <button type="button" disabled={owners.length === 1} onClick={() => setOwners(owners.filter((_, j) => j !== i))} className={quiet} aria-label={`Remove person ${i + 1}`}>
            Remove
          </button>
        </div>
      ))}
      <div>
        <button
          type="button"
          disabled={owners.length >= MAX_OWNERS}
          onClick={() => setOwners([...owners, { fullName: "", role: "owner", ownershipPct: "", country: "" }])}
          className={quiet}
        >
          + Add a person
        </button>
      </div>
      <ErrorLine error={error} />
      <div>
        <button
          type="button"
          disabled={pending}
          className={primary}
          onClick={() =>
            run(
              () =>
                saveOwnersAction(
                  token,
                  owners.map((o) => ({ fullName: o.fullName, role: o.role, ownershipPct: o.ownershipPct.trim() === "" ? null : o.ownershipPct, country: o.country })),
                ),
              () => onSaved({ ...data, owners }),
            )
          }
        >
          {pending ? "Saving…" : "Save and continue"}
        </button>
      </div>
    </Section>
  );
}

function ConsentStep({ token, data, onChange, onContinue }: { token: string; data: WizardInitial; onChange: (d: WizardInitial) => void; onContinue: () => void }) {
  return (
    <Section title="Your consent" hint="We need your written consent before running any checks. Type your full name to give it.">
      {CONSENT_SCOPES.map((scope) => (
        <ConsentBlock key={scope} token={token} scope={scope} data={data} onChange={onChange} />
      ))}
      <div>
        <button type="button" className={primary} onClick={onContinue}>
          Continue
        </button>
      </div>
    </Section>
  );
}

function ConsentBlock({ token, scope, data, onChange }: { token: string; scope: ConsentScope; data: WizardInitial; onChange: (d: WizardInitial) => void }) {
  const given = data.consents.find((c) => c.scope === scope && c.textVersion === CONSENT_TEXT_VERSION);
  const [name, setName] = useState(data.legalName);
  const { error, pending, run } = useSave();
  const text = CONSENT_TEXT[scope];

  return (
    <div className="rounded-lg border border-line bg-surface-0 p-4">
      <p className="text-sm font-medium text-fg-primary">{text.title}</p>
      <p className="mt-1 text-sm text-fg-secondary">{text.body}</p>
      {given ? (
        <p role="status" className="mt-3 text-sm text-emerald-300">
          ✓ Consent given by {given.typedName}
        </p>
      ) : (
        <div className="mt-3 grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
          <label className="block">
            <span className={label}>Type your full name</span>
            <input aria-label={`${text.title} typed name`} value={name} maxLength={200} onChange={(e) => setName(e.target.value)} className={`${field} mt-1`} />
          </label>
          <button
            type="button"
            disabled={pending || !name.trim()}
            className={primary}
            aria-label={`I agree: ${text.title}`}
            onClick={() =>
              run(
                () => grantConsentAction(token, { scope, typedName: name }),
                () =>
                  onChange({
                    ...data,
                    consents: [...data.consents, { scope, textVersion: CONSENT_TEXT_VERSION, typedName: name.trim(), consentedAt: new Date().toISOString() }],
                  }),
              )
            }
          >
            {pending ? "Saving…" : "I agree"}
          </button>
        </div>
      )}
      <ErrorLine error={error} />
    </div>
  );
}

function IdentityStep({
  token,
  lpType,
  state,
  returning,
  onState,
  onContinue,
}: {
  token: string;
  lpType: LpType;
  state: IdentityState;
  /** The LP already started verification, so check how it went as soon as they arrive. */
  returning: boolean;
  onState: (s: IdentityState) => void;
  onContinue: () => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const polls = useRef(0);
  const [tick, setTick] = useState(0);

  const check = () =>
    startTransition(async () => {
      const res = await checkIdentityAction(token).catch(() => ({ ok: false as const, error: "Something went wrong. Try again." }));
      setTick((t) => t + 1);
      if (!res.ok) return setError(res.error);
      setError(null);
      onState(res.state);
    });

  // On coming back from the verification page, and while it is being checked, ask for the result.
  useEffect(() => {
    if (state === "verified") return;
    if (state !== "processing" && !(returning && polls.current === 0)) return;
    if (polls.current >= 20) return;
    const wait = polls.current === 0 ? 0 : 4000;
    const timer = setTimeout(() => {
      polls.current += 1;
      check();
    }, wait);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, returning, tick]);

  const start = () =>
    startTransition(async () => {
      setError(null);
      const res = await startIdentityAction(token).catch(() => ({ ok: false as const, error: "Something went wrong. Try again." }));
      if (!res.ok) return setError(res.error);
      onState(res.state);
      // Only ever follow a secure link.
      if (res.url && res.url.startsWith("https://")) goTo(res.url);
    });

  return (
    <Section
      title="Verify your identity"
      hint={
        lpType === "individual"
          ? "You'll take a photo of a government ID and a selfie on a secure page run by Stripe."
          : "The person who signs for the entity takes a photo of a government ID and a selfie on a secure page run by Stripe."
      }
    >
      <p className="text-sm text-fg-secondary">
        Stripe keeps the images. Your fund manager sees only whether you passed. It takes about two minutes, and you&apos;ll come back to this page afterwards.
      </p>
      {state === "verified" ? (
        <p role="status" className="text-sm text-emerald-300">
          ✓ Your identity is verified.
        </p>
      ) : null}
      {state === "processing" ? (
        <p role="status" className="text-sm text-fg-primary">
          Checking your documents. This usually takes under a minute.
        </p>
      ) : null}
      {state === "needs_input" ? (
        <p role="status" className="text-sm text-fg-primary">
          Your verification isn&apos;t finished yet. Open it again to continue.
        </p>
      ) : null}
      <ErrorLine error={error} />
      <div className="flex flex-wrap items-center gap-3">
        {state === "verified" ? (
          <button type="button" className={primary} onClick={onContinue}>
            Continue
          </button>
        ) : (
          <>
            {state !== "processing" ? (
              <button type="button" disabled={pending} className={primary} onClick={start}>
                {pending ? "Opening…" : state === "needs_input" ? "Continue verification" : "Verify my identity"}
              </button>
            ) : null}
            {state === "processing" || state === "needs_input" ? (
              <button type="button" disabled={pending} className={quiet} onClick={check}>
                Check status
              </button>
            ) : null}
          </>
        )}
      </div>
    </Section>
  );
}

function AccreditationStep({ token, data, onSaved }: { token: string; data: WizardInitial; onSaved: (d: WizardInitial) => void }) {
  const [basis, setBasis] = useState<LpAccreditationBasis | "">(data.accreditationBasis);
  const [stated, setStated] = useState(data.accreditationStated);
  const [source, setSource] = useState(data.sourceOfFunds);
  const { error, pending, run } = useSave();

  return (
    <Section title="Accreditation and source of funds" hint="This is your own statement. Your fund manager reviews it and may ask for supporting evidence.">
      <fieldset className="grid gap-2">
        <legend className={label}>How do you qualify?</legend>
        {(Object.keys(ACCREDITATION_BASIS_LABEL) as LpAccreditationBasis[]).map((b) => (
          <label key={b} className="flex items-center gap-2 text-sm text-fg-primary">
            <input type="radio" name="basis" checked={basis === b} onChange={() => setBasis(b)} />
            {ACCREDITATION_BASIS_LABEL[b]}
          </label>
        ))}
      </fieldset>
      <label className="block">
        <span className={label}>Where does the money you&apos;ll invest come from?</span>
        <textarea
          aria-label="Source of funds"
          value={source}
          maxLength={SOURCE_OF_FUNDS_MAX}
          rows={3}
          onChange={(e) => setSource(e.target.value)}
          placeholder="For example: proceeds from the sale of a business, salary and investment income, fund assets from our members."
          className={`${field} mt-1`}
        />
      </label>
      <label className="flex items-start gap-2 text-sm text-fg-primary">
        <input type="checkbox" checked={stated} onChange={(e) => setStated(e.target.checked)} className="mt-1" />
        <span>I confirm that what I&apos;ve said here is true and complete.</span>
      </label>
      <ErrorLine error={error} />
      <div>
        <button
          type="button"
          disabled={pending}
          className={primary}
          onClick={() =>
            run(
              () => saveAccreditationAction(token, { basis, statement: stated, sourceOfFunds: source }),
              () => onSaved({ ...data, accreditationBasis: basis, accreditationStated: stated, sourceOfFunds: source }),
            )
          }
        >
          {pending ? "Saving…" : "Save and continue"}
        </button>
      </div>
    </Section>
  );
}

function ReviewStep({ token, missing, goTo, onSubmitted }: { token: string; missing: WizardStepKey[]; goTo: (s: WizardStepKey) => void; onSubmitted: () => void }) {
  const { error, pending, run } = useSave();
  return (
    <Section title="Review and submit" hint="When you submit, your fund manager reviews your answers and the checks. You can't change them again unless they ask for more information.">
      {missing.length ? (
        <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-300">
          <p>Still to do:</p>
          <ul className="mt-1 flex flex-wrap gap-2">
            {missing.map((s) => (
              <li key={s}>
                <button type="button" onClick={() => goTo(s)} className="underline">
                  {STEP_LABEL[s]}
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <p className="text-sm text-emerald-300">Everything is filled in.</p>
      )}
      <ErrorLine error={error} />
      <div>
        <button type="button" disabled={pending || missing.length > 0} className={primary} onClick={() => run(() => submitWizardAction(token), onSubmitted)}>
          {pending ? "Submitting…" : "Submit for review"}
        </button>
      </div>
    </Section>
  );
}
