'use client';

import { useId, useRef, useState, type FormEvent } from 'react';
import { ArrowRight, CheckCircle2 } from 'lucide-react';
import { Input, Select } from '@/components/ui';
import { PRIMARY_CTA } from '@/components/landing/cta';
import { track } from '@/lib/landing/analytics';
import { submitAccessRequest } from '@/lib/actions/access-request';
import { RAISING_RANGES } from '@/lib/landing/access-request';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type FieldName = 'email' | 'fullName' | 'firm' | 'roleTitle' | 'raisingRange';

/**
 * RequestAccessForm — the five-field lead-capture form behind every
 * "Request access" CTA. Used inside the modal (RequestAccessModal) and on the
 * standalone /request-access route.
 *
 * Submission routes exclusively through `submitAccessRequest()`
 * (lib/actions/access-request.ts) — the single, swappable backend point.
 * Per-field errors are tied to inputs via aria-describedby; on success the
 * form is replaced with a confirmation that sets cohort expectations.
 */
export function RequestAccessForm({ source = 'landing' }: { source?: string }) {
  const idBase = useId();
  const startedRef = useRef(false);

  const [email, setEmail] = useState('');
  const [fullName, setFullName] = useState('');
  const [firm, setFirm] = useState('');
  const [roleTitle, setRoleTitle] = useState('');
  const [raisingRange, setRaisingRange] = useState('');
  const [referralCode, setReferralCode] = useState('');

  const [fieldErrors, setFieldErrors] = useState<Partial<Record<FieldName, string>>>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  function onFirstInteraction() {
    if (startedRef.current) return;
    startedRef.current = true;
    track('request_access_start', { source });
  }

  function validate(): Partial<Record<FieldName, string>> {
    const errors: Partial<Record<FieldName, string>> = {};
    if (!EMAIL_RE.test(email.trim())) errors.email = 'Enter a valid work email.';
    if (!fullName.trim()) errors.fullName = 'Enter your full name.';
    if (!firm.trim()) errors.firm = 'Enter your firm or fund name.';
    if (!roleTitle.trim()) errors.roleTitle = 'Enter your role or title.';
    if (!raisingRange) errors.raisingRange = 'Select a range.';
    return errors;
  }

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (submitting) return;
    setSubmitError(null);

    const errors = validate();
    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) return;

    setSubmitting(true);
    try {
      const result = await submitAccessRequest({
        email: email.trim(),
        fullName: fullName.trim(),
        firm: firm.trim(),
        roleTitle: roleTitle.trim(),
        raisingRange,
        referralCode: referralCode.trim() || null,
        source
      });
      track('request_access_submit', { source, ok: result.ok });
      if (result.ok) {
        setSubmitted(true);
      } else {
        setSubmitError(result.error);
      }
    } catch {
      track('request_access_submit', { source, ok: false });
      setSubmitError('Something went wrong. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  if (submitted) {
    return (
      <div className="flex flex-col items-center py-6 text-center" role="status">
        <span className="flex h-12 w-12 items-center justify-center rounded-full border border-[var(--gold-line)] bg-[var(--gold-soft)] text-gold-1">
          <CheckCircle2 size={24} strokeWidth={1.9} aria-hidden />
        </span>
        <h3 className="mt-4 text-lg font-semibold text-fg-1">You&rsquo;re on the list.</h3>
        <p className="mt-2 max-w-sm text-[13.5px] leading-6 text-fg-3">
          We onboard in small cohorts and review every request personally. Keep an eye on your
          inbox — we&rsquo;ll reach out when your desk is ready.
        </p>
      </div>
    );
  }

  const errId = (name: FieldName) => `${idBase}-${name}-error`;

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
      <div>
        <Input
          label="Work email"
          type="email"
          name="email"
          autoComplete="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          onFocus={onFirstInteraction}
          placeholder="you@yourfirm.com"
          aria-invalid={Boolean(fieldErrors.email)}
          aria-describedby={fieldErrors.email ? errId('email') : undefined}
        />
        {fieldErrors.email && (
          <p id={errId('email')} className="mt-1.5 text-[11.5px] text-danger" role="alert">
            {fieldErrors.email}
          </p>
        )}
      </div>

      <div>
        <Input
          label="Full name"
          type="text"
          name="name"
          autoComplete="name"
          required
          value={fullName}
          onChange={(e) => setFullName(e.target.value)}
          onFocus={onFirstInteraction}
          placeholder="Jordan Reese"
          aria-invalid={Boolean(fieldErrors.fullName)}
          aria-describedby={fieldErrors.fullName ? errId('fullName') : undefined}
        />
        {fieldErrors.fullName && (
          <p id={errId('fullName')} className="mt-1.5 text-[11.5px] text-danger" role="alert">
            {fieldErrors.fullName}
          </p>
        )}
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <Input
            label="Firm / fund name"
            type="text"
            name="organization"
            autoComplete="organization"
            required
            value={firm}
            onChange={(e) => setFirm(e.target.value)}
            onFocus={onFirstInteraction}
            placeholder="Meridian Capital"
            aria-invalid={Boolean(fieldErrors.firm)}
            aria-describedby={fieldErrors.firm ? errId('firm') : undefined}
          />
          {fieldErrors.firm && (
            <p id={errId('firm')} className="mt-1.5 text-[11.5px] text-danger" role="alert">
              {fieldErrors.firm}
            </p>
          )}
        </div>
        <div>
          <Input
            label="Role / title"
            type="text"
            name="organization-title"
            autoComplete="organization-title"
            required
            value={roleTitle}
            onChange={(e) => setRoleTitle(e.target.value)}
            onFocus={onFirstInteraction}
            placeholder="Managing Partner"
            aria-invalid={Boolean(fieldErrors.roleTitle)}
            aria-describedby={fieldErrors.roleTitle ? errId('roleTitle') : undefined}
          />
          {fieldErrors.roleTitle && (
            <p id={errId('roleTitle')} className="mt-1.5 text-[11.5px] text-danger" role="alert">
              {fieldErrors.roleTitle}
            </p>
          )}
        </div>
      </div>

      <div>
        <Select
          label="What are you raising / current AUM"
          required
          value={raisingRange}
          onChange={(e) => setRaisingRange(e.target.value)}
          onFocus={onFirstInteraction}
          placeholder="Select a range"
          options={RAISING_RANGES.map((r) => ({ value: r.value, label: r.label }))}
          aria-invalid={Boolean(fieldErrors.raisingRange)}
          aria-describedby={fieldErrors.raisingRange ? errId('raisingRange') : undefined}
        />
        {fieldErrors.raisingRange && (
          <p id={errId('raisingRange')} className="mt-1.5 text-[11.5px] text-danger" role="alert">
            {fieldErrors.raisingRange}
          </p>
        )}
      </div>

      <Input
        label="Invite or referral code (optional)"
        type="text"
        value={referralCode}
        onChange={(e) => setReferralCode(e.target.value)}
        onFocus={onFirstInteraction}
        placeholder="FX-XXXX"
      />

      {submitError && (
        <p className="rounded-xl border border-[var(--danger-line)] bg-[var(--danger-soft)] px-3 py-2.5 text-[12.5px] text-danger" role="alert">
          {submitError}
        </p>
      )}

      <button type="submit" disabled={submitting} className={`${PRIMARY_CTA} w-full disabled:opacity-60`}>
        {submitting ? 'Submitting…' : 'Request access'}
        {!submitting && <ArrowRight size={17} strokeWidth={2} aria-hidden />}
      </button>

      <p className="text-center text-[11.5px] leading-relaxed text-fg-5">
        Invite-only. We&rsquo;re onboarding a limited cohort this quarter.
      </p>
    </form>
  );
}

export default RequestAccessForm;
