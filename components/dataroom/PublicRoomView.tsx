'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import {
  CalendarClock,
  CheckCircle2,
  FileText,
  Loader2,
  Lock,
  ShieldCheck,
  TriangleAlert
} from 'lucide-react';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { MATERIAL_BUILD, MAT_META, type MaterialValue } from '@/lib/dataroom/config';
import { verifyDataRoomViewer } from '@/lib/dataroom/public-actions';
import { cn } from '@/lib/utils';

/**
 * PublicRoomView — what a recipient sees at /dr/[token]: the vetting gate
 * first (their access is logged the moment they pass it), then the shared
 * material's real outline. No app chrome, no session — possession of the
 * link plus the attestation is the whole contract.
 */

export interface PublicRoomProps {
  token: string;
  label: string;
  vetting: string;
  expired: boolean;
  firm: string;
  /** Set when this browser already passed the gate (the per-link cookie). */
  viewerName: string | null;
  material: {
    materialId: string;
    title: string;
    spec: Record<string, MaterialValue>;
    preparedAt: string | null;
  } | null;
}

const VETTING_COPY: Record<string, { badge: string; blurb: string; attest: string | null }> = {
  open: {
    badge: 'Open access',
    blurb: 'The manager shares this openly — identify yourself and you’re in.',
    attest: null
  },
  accreditation: {
    badge: 'Accredited only',
    blurb: 'This room is limited to accredited investors.',
    attest: 'I confirm I am an accredited investor under applicable securities laws.'
  },
  nda: {
    badge: 'Accredited + NDA',
    blurb: 'This room is limited to accredited investors and its contents are confidential.',
    attest:
      'I confirm I am an accredited investor and agree to keep the contents of this room confidential.'
  }
};

export function PublicRoomView({
  token,
  label,
  vetting,
  expired,
  firm,
  viewerName,
  material
}: PublicRoomProps) {
  const router = useRouter();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [attested, setAttested] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const copy = VETTING_COPY[vetting] ?? VETTING_COPY.nda;
  const needsAttest = copy.attest !== null;
  const ready = name.trim().length > 0 && email.trim().length > 3 && (!needsAttest || attested);

  function enter() {
    setError(null);
    start(async () => {
      const res = await verifyDataRoomViewer({ token, name, email, attested });
      if (res.ok) {
        router.refresh();
      } else {
        setError(res.error);
      }
    });
  }

  if (expired) {
    return (
      <Card className="p-8 text-center">
        <CalendarClock size={22} className="mx-auto text-fg-4" aria-hidden />
        <h1 className="mt-3 text-[16px] font-semibold text-fg-1">This link has expired</h1>
        <p className="mx-auto mt-1.5 max-w-md text-[12.5px] leading-relaxed text-fg-4">
          {firm} set an expiry on this room. Ask them for a fresh link — access stays in their
          hands, not the URL&rsquo;s.
        </p>
      </Card>
    );
  }

  /* ── the gate ─────────────────────────────────────────────────────── */
  if (!viewerName) {
    return (
      <Card className="flex flex-col gap-4 p-6">
        <div className="flex items-center gap-3">
          <span className="flex h-11 w-11 flex-none items-center justify-center rounded-[12px] border border-[var(--gold-line)] bg-[var(--gold-soft)] text-gold-1">
            <Lock size={20} strokeWidth={1.9} aria-hidden />
          </span>
          <div className="min-w-0 flex-1">
            <h1 className="text-[17px] font-semibold tracking-[-0.01em] text-fg-1">{label}</h1>
            <p className="text-[12px] text-fg-4">
              Shared by <b className="text-fg-2">{firm}</b>
            </p>
          </div>
          <Badge tone="gold" className="flex-none">
            {copy.badge}
          </Badge>
        </div>
        <p className="text-[12.5px] leading-relaxed text-fg-3">
          {copy.blurb} Your access is logged for the manager&rsquo;s records.
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          <Input
            label="Your name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Full name"
            maxLength={120}
            autoComplete="name"
          />
          <Input
            label="Email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@firm.com"
            maxLength={200}
            autoComplete="email"
          />
        </div>
        {needsAttest && (
          <label className="flex cursor-pointer items-start gap-2.5 rounded-xl border border-hairline bg-surface-1 px-3.5 py-3">
            <input
              type="checkbox"
              checked={attested}
              onChange={(e) => setAttested(e.target.checked)}
              className="mt-0.5 h-4 w-4 flex-none accent-[var(--accent)]"
            />
            <span className="text-[12px] leading-relaxed text-fg-2">{copy.attest}</span>
          </label>
        )}
        {error && (
          <div
            role="alert"
            className="flex items-center gap-2.5 rounded-xl border border-[var(--danger-line)] bg-[var(--danger-soft)] px-3.5 py-2.5 text-[12.5px] text-danger"
          >
            <TriangleAlert size={15} aria-hidden />
            {error}
          </div>
        )}
        <Button icon={pending ? Loader2 : ShieldCheck} disabled={!ready || pending} onClick={enter}>
          {pending ? 'Verifying…' : 'Enter the room'}
        </Button>
      </Card>
    );
  }

  /* ── the room ─────────────────────────────────────────────────────── */
  const build = material ? MATERIAL_BUILD[material.materialId] : null;
  const meta = material ? MAT_META[material.materialId] : null;

  return (
    <div className="flex flex-col gap-4">
      <Card className="flex items-center gap-3 p-5">
        <span className="flex h-11 w-11 flex-none items-center justify-center rounded-[12px] border border-[var(--accent-line)] bg-[var(--accent-soft)] text-[var(--accent)]">
          <FileText size={20} strokeWidth={1.9} aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <h1 className="text-[17px] font-semibold tracking-[-0.01em] text-fg-1">
            {material?.title ?? label}
          </h1>
          <p className="text-[12px] text-fg-4">
            Shared by <b className="text-fg-2">{firm}</b>
            {meta ? ` · ${meta.cat} · ${meta.fmt}` : ''}
            {material?.preparedAt
              ? ` · prepared ${new Date(material.preparedAt).toLocaleDateString()}`
              : ''}
          </p>
        </div>
        <Badge tone="success" className="flex-none" dot>
          Access logged · {viewerName}
        </Badge>
      </Card>

      {material && build ? (
        <Card className="flex flex-col gap-4 p-6">
          <div className="text-[10.5px] font-semibold uppercase tracking-[0.11em] text-fg-4">
            What this covers
          </div>
          {build.decisions.map((d) => {
            const value = material.spec[d.key];
            const values = Array.isArray(value) ? value : value ? [value] : [];
            return (
              <div key={d.key}>
                <div className="mb-1.5 text-[12.5px] font-medium text-fg-3">{d.label}</div>
                <div className="flex flex-wrap gap-1.5">
                  {values.length > 0 ? (
                    values.map((v) => (
                      <span
                        key={v}
                        className={cn(
                          'rounded-full border px-3 py-1 text-[12px]',
                          d.kind === 'radio'
                            ? 'border-[var(--accent-line)] bg-[var(--accent-soft)] font-semibold text-fg-1'
                            : 'border-hairline bg-surface-1 text-fg-2'
                        )}
                      >
                        {v}
                      </span>
                    ))
                  ) : (
                    <span className="text-[12px] text-fg-5">—</span>
                  )}
                </div>
              </div>
            );
          })}
          <div className="flex items-center gap-2.5 rounded-xl border border-hairline bg-surface-1 px-3.5 py-3 text-[12px] leading-relaxed text-fg-3">
            <CheckCircle2 size={15} className="flex-none text-success" aria-hidden />
            The full document is delivered by {firm} on request — this room confirms what&rsquo;s
            prepared and ready.
          </div>
        </Card>
      ) : (
        <Card className="p-8 text-center">
          <FileText size={22} className="mx-auto text-fg-4" aria-hidden />
          <h2 className="mt-3 text-[15px] font-semibold text-fg-1">Being prepared</h2>
          <p className="mx-auto mt-1.5 max-w-md text-[12.5px] leading-relaxed text-fg-4">
            {firm} is still assembling this material. Your access is registered — they can follow up
            the moment it&rsquo;s ready.
          </p>
        </Card>
      )}

      <p className="text-center text-[11px] text-fg-5">
        Access to this room is logged · Powered by FundExecs OS
      </p>
    </div>
  );
}
