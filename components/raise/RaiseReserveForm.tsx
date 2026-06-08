'use client';

import { useRef, useState, useTransition } from 'react';
import { ArrowRight, CheckCircle2, FileText, Info, X } from 'lucide-react';
import { submitRaiseReservation } from '@/lib/actions/raise-reservation';
import { createAccreditationUploadUrl } from '@/lib/actions/accreditation-evidence';

/* RaiseReserveForm — opt-in reservation form on a 506(c) public raise page.
 *
 * When the owner has enabled accept_reservations=true the page renders this form
 * alongside (or instead of) the "express interest" form. On success either:
 *   - redirects the browser to the Stripe Checkout URL (Stripe configured), or
 *   - swaps to a calm "intent recorded" confirmation (Stripe unconfigured / degraded).
 *
 * The accredited-investor attestation is always required here (506(c)-only). */

const ALLOWED_UPLOAD_TYPES = new Set(['application/pdf', 'image/png', 'image/jpeg', 'image/webp']);
const MAX_UPLOAD_BYTES = 15 * 1024 * 1024;

function formatBytes(n: number): string {
  if (n >= 1_048_576) return `${(n / 1_048_576).toFixed(1)} MB`;
  if (n >= 1_024) return `${Math.round(n / 1_024)} KB`;
  return `${n} B`;
}

export function RaiseReserveForm({ token, minCheck }: { token: string; minCheck: number | null }) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [accredited, setAccredited] = useState(false);
  const [verificationMethod, setVerificationMethod] = useState('');
  const [verificationEvidence, setVerificationEvidence] = useState('');
  const [docFile, setDocFile] = useState<File | null>(null);
  const [docError, setDocError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [intentOnly, setIntentOnly] = useState(false);
  const [pending, startTransition] = useTransition();

  if (intentOnly) {
    return (
      <div className="rounded-2xl border border-success-line bg-success-soft p-6 text-center">
        <CheckCircle2 className="mx-auto mb-2 text-success" size={26} strokeWidth={2} aria-hidden />
        <h3 className="text-[15px] font-semibold text-fg-1">Reservation recorded</h3>
        <p className="mx-auto mt-1 max-w-[46ch] text-[13px] text-fg-3">
          Your reservation intent has been recorded and the team has been notified. They will follow
          up with next steps directly. This is not a binding investment commitment.
        </p>
      </div>
    );
  }

  function onFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    setDocError(null);
    const file = e.target.files?.[0] ?? null;
    // Reset the input value so re-selecting the same file fires onChange again.
    e.target.value = '';
    if (!file) return;
    if (!ALLOWED_UPLOAD_TYPES.has(file.type)) {
      setDocError('Only PDF, PNG, JPEG, or WebP files are accepted.');
      return;
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      setDocError('File exceeds the 15 MB limit.');
      return;
    }
    setDocFile(file);
  }

  function clearDocFile() {
    setDocFile(null);
    setDocError(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      try {
        // If a document was selected, upload it first and obtain the storage path.
        let verificationDocumentPath: string | null = null;
        if (docFile) {
          const uploadRes = await createAccreditationUploadUrl({
            token,
            filename: docFile.name,
            contentType: docFile.type,
            sizeBytes: docFile.size
          });
          if (!uploadRes.ok) {
            setError(`Document upload failed: ${uploadRes.error}`);
            return;
          }
          // PUT the file directly to Supabase Storage via the signed URL.
          try {
            const put = await fetch(uploadRes.signedUrl, {
              method: 'PUT',
              body: docFile,
              headers: { 'Content-Type': docFile.type }
            });
            if (!put.ok) {
              setError(`Document upload failed (HTTP ${put.status}). Please try again.`);
              return;
            }
          } catch {
            setError('Document upload failed. Please check your connection and try again.');
            return;
          }
          verificationDocumentPath = uploadRes.path;
        }

        const res = await submitRaiseReservation({
          token,
          name,
          email,
          amount: Number(amount.replace(/[^0-9.]/g, '')) || 0,
          note,
          accredited,
          verificationMethod: verificationMethod || null,
          verificationEvidence: verificationEvidence || null,
          verificationDocumentPath
        });
        if (!res.ok) {
          setError(res.error);
          return;
        }
        if (res.url) {
          // Redirect to Stripe Checkout.
          window.location.href = res.url;
        } else {
          // Stripe not configured — show intent confirmation.
          setIntentOnly(true);
        }
      } catch {
        setError('Could not submit your reservation. Please try again.');
      }
    });
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3" noValidate>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Your name" required>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoComplete="name"
            maxLength={120}
            className={inputCls}
            placeholder="Jane Investor"
          />
        </Field>
        <Field label="Email" required>
          <input
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            type="email"
            autoComplete="email"
            maxLength={254}
            className={inputCls}
            placeholder="jane@firm.com"
          />
        </Field>
      </div>

      <Field
        label="Reservation amount"
        hint={minCheck ? `Min. ${formatMoney(minCheck)}` : 'Required'}
        required
      >
        <div className="relative">
          <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[13px] text-fg-4">
            $
          </span>
          <input
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            inputMode="numeric"
            maxLength={16}
            className={`${inputCls} pl-7`}
            placeholder="100,000"
          />
        </div>
      </Field>

      <Field label="Note" hint="Optional">
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={2}
          maxLength={1000}
          className={`${inputCls} resize-none`}
          placeholder="Any questions or context for the team."
        />
      </Field>

      {/* Accreditation verification method — 506(c) "reasonable steps" */}
      <Field label="How will you verify accredited status?" required>
        <select
          value={verificationMethod}
          onChange={(e) => setVerificationMethod(e.target.value)}
          className={inputCls}
          aria-required="true"
        >
          <option value="">Select a method…</option>
          <option value="income">Income (tax returns / W-2)</option>
          <option value="net_worth">Net worth (assets &amp; liabilities)</option>
          <option value="professional_license">Licensed professional (Series 7/65/82)</option>
          <option value="third_party_letter">Third-party letter (CPA / attorney / broker)</option>
          <option value="other">Other</option>
        </select>
      </Field>

      <Field label="Verification evidence" hint="Optional — a note or link">
        <input
          value={verificationEvidence}
          onChange={(e) => setVerificationEvidence(e.target.value)}
          maxLength={500}
          className={inputCls}
          placeholder="e.g. link to a verification letter; the team will follow up"
        />
      </Field>

      {/* Accreditation document upload — optional; investors may attach a PDF or image */}
      <div className="flex flex-col gap-1.5">
        <span className="flex items-center justify-between text-[11.5px] font-medium text-fg-2">
          <span className="flex items-center gap-1.5">
            <FileText size={12} strokeWidth={2} aria-hidden />
            Accreditation document
          </span>
          <span className="font-normal text-fg-4">Optional — PDF or image, up to 15&nbsp;MB</span>
        </span>

        {/* Hidden file input; triggered by the button below */}
        <input
          ref={fileInputRef}
          type="file"
          accept="application/pdf,image/png,image/jpeg,image/webp"
          onChange={onFileChange}
          className="hidden"
          aria-label="Upload accreditation document"
        />

        {docFile ? (
          /* Selected-file confirmation with clear button */
          <div className="flex items-center justify-between gap-2 rounded-xl border border-hairline bg-surface-1 px-3 py-2">
            <span className="min-w-0 truncate text-[12.5px] text-fg-2">
              {docFile.name}
              <span className="ml-2 text-fg-4">({formatBytes(docFile.size)})</span>
            </span>
            <button
              type="button"
              onClick={clearDocFile}
              aria-label="Remove selected file"
              className="shrink-0 rounded p-0.5 text-fg-4 transition hover:text-danger"
            >
              <X size={13} strokeWidth={2.2} aria-hidden />
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-hairline bg-surface-1 px-3 py-2 text-[12.5px] text-fg-3 transition hover:border-accent-line hover:text-fg-1"
          >
            <FileText size={13} strokeWidth={2} aria-hidden />
            Choose file…
          </button>
        )}
        {docError ? (
          <p role="alert" className="text-[12px] text-danger">
            {docError}
          </p>
        ) : null}
      </div>

      {/* Accreditation attestation — always required on the reserve path */}
      <label className="flex items-start gap-2.5 rounded-xl border border-hairline bg-surface-1 px-3 py-2.5">
        <input
          type="checkbox"
          checked={accredited}
          onChange={(e) => setAccredited(e.target.checked)}
          className="mt-0.5 h-4 w-4 shrink-0 accent-[var(--accent)]"
          aria-required="true"
        />
        <span className="text-[12.5px] text-fg-2">
          I am an accredited investor as defined under SEC Rule 501(a). I understand this raise is
          limited to accredited investors under Reg D 506(c), and that the issuer must take
          reasonable steps to verify my status before closing.
        </span>
      </label>

      <div className="flex items-start gap-1.5 rounded-xl border border-azure-line bg-azure-soft px-3 py-2.5">
        <Info size={13} strokeWidth={2} className="mt-0.5 shrink-0 text-azure-1" aria-hidden />
        <p className="text-[12px] text-fg-3">
          Submitting a reservation is not a binding investment commitment. Payment will be collected
          via Stripe Checkout; you may cancel any time before closing.
        </p>
      </div>

      {error ? (
        <p role="alert" className="text-[12.5px] text-danger">
          {error}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={pending || !accredited || !verificationMethod}
        className="mt-1 inline-flex items-center justify-center gap-2 rounded-xl bg-accent px-4 py-2.5 text-[13.5px] font-semibold text-white shadow-[var(--shadow-md)] transition hover:bg-accent-2 disabled:opacity-60"
      >
        {pending ? 'Processing…' : 'Reserve my spot'}
        {!pending ? <ArrowRight size={15} strokeWidth={2.2} aria-hidden /> : null}
      </button>
      <p className="text-center text-[11px] text-fg-4">
        Reserving is not a commitment to invest. You may withdraw at any time.
      </p>
    </form>
  );
}

const inputCls =
  'w-full rounded-xl border border-hairline bg-surface-1 px-3 py-2 text-[13.5px] text-fg-1 placeholder:text-fg-4 outline-none transition focus:border-accent-line focus:bg-surface-2';

function Field({
  label,
  hint,
  required,
  children
}: {
  label: string;
  hint?: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="flex items-center justify-between text-[11.5px] font-medium text-fg-2">
        <span>
          {label}
          {required ? <span className="text-danger"> *</span> : null}
        </span>
        {hint ? <span className="font-normal text-fg-4">{hint}</span> : null}
      </span>
      {children}
    </label>
  );
}

function formatMoney(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${Math.round(n / 1_000)}K`;
  return `$${n}`;
}
