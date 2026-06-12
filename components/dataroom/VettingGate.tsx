'use client';

import { useEffect, useRef, useState } from 'react';
import {
  Building2,
  Check,
  CheckCircle2,
  Eye,
  FileText,
  FolderLock,
  Info,
  Mail,
  User,
  X
} from 'lucide-react';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { EarnCoin } from '@/components/ui/EarnCoin';
import { Input } from '@/components/ui/Input';
import type { DataRoomProspect } from '@/lib/dataroom/config';
import { cn } from '@/lib/utils';

/* ── the recipient vetting gate (a labelled preview of the LP experience) ── */

const VETTING_FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function VettingGate({
  docName,
  firm,
  prospect,
  onVerify,
  onClose
}: {
  docName: string;
  firm: string;
  prospect: DataRoomProspect;
  onVerify: (who: { name: string; firm: string }) => void;
  onClose: () => void;
}) {
  const [step, setStep] = useState<'verify' | 'unlocked'>('verify');
  const [name, setName] = useState(prospect.name);
  const [pfirm, setPfirm] = useState(prospect.firm);
  const [email, setEmail] = useState(
    `${prospect.name.split(' ')[0].toLowerCase()}@${prospect.firm.toLowerCase().replace(/[^a-z]/g, '')}.com`
  );
  const [accredited, setAccredited] = useState(false);
  const [nda, setNda] = useState(false);
  const ready = name && pfirm && email && accredited && nda;

  const panelRef = useRef<HTMLDivElement>(null);
  const openerRef = useRef<HTMLElement | null>(null);

  // Full dialog ergonomics: move focus into the gate on open, trap Tab within
  // it, close on Escape, lock background scroll, and restore focus on close.
  useEffect(() => {
    openerRef.current = document.activeElement as HTMLElement | null;
    const panel = panelRef.current;
    panel?.querySelector<HTMLElement>(VETTING_FOCUSABLE)?.focus();

    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
        return;
      }
      if (e.key !== 'Tab' || !panel) return;
      const focusable = Array.from(panel.querySelectorAll<HTMLElement>(VETTING_FOCUSABLE));
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;
      if (e.shiftKey && (active === first || !panel.contains(active))) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (active === last || !panel.contains(active))) {
        e.preventDefault();
        first.focus();
      }
    }

    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('keydown', onKey, true);
      document.body.style.overflow = prevOverflow;
      openerRef.current?.focus?.();
    };
  }, [onClose]);

  return (
    <>
      <div
        onClick={onClose}
        className="fixed inset-0 z-[60] bg-[rgba(3,6,12,0.7)] backdrop-blur-[3px]"
        aria-hidden
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={`Preview the recipient gate for ${docName}`}
        className="fixed left-1/2 top-1/2 z-[61] max-h-[88vh] w-[440px] max-w-[94vw] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-[20px] border border-[var(--border-strong)] bg-bg-2 shadow-[0_40px_90px_-30px_rgba(0,0,0,0.7)]"
      >
        {step === 'verify' ? (
          <div className="p-6">
            <div className="mb-1 flex items-center gap-2.5">
              <EarnCoin size={22} className="flex-none" />
              <span className="text-[12px] font-semibold tracking-[-0.02em]">
                FundExecs <span className="font-medium text-fg-4">OS</span>
              </span>
              <Badge tone="warning" className="px-1.5 py-0 text-[9px]">
                Preview
              </Badge>
              <span className="flex-1" />
              <button
                type="button"
                onClick={onClose}
                aria-label="Close"
                className="flex h-7 w-7 items-center justify-center rounded-lg text-fg-4 hover:bg-surface-1"
              >
                <X size={16} aria-hidden />
              </button>
            </div>
            <div className="my-3 flex flex-col items-center text-center">
              <span className="mb-3 flex h-[46px] w-[46px] items-center justify-center rounded-[13px] border border-[var(--gold-line)] bg-[var(--gold-soft)] text-gold-1">
                <FolderLock size={22} aria-hidden />
              </span>
              <div className="text-[16px] font-semibold tracking-[-0.01em] text-fg-1">
                {firm} shared a confidential document
              </div>
              <div className="mt-1.5 text-[12.5px] text-fg-3">
                This is what a recipient sees: verify identity to unlock{' '}
                <span className="font-semibold text-fg-1">{docName}</span>. Access is logged and
                watermarked.
              </div>
            </div>
            <div className="flex flex-col gap-3">
              <Input
                label="Full name"
                icon={User}
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
              <Input
                label="Firm"
                icon={Building2}
                value={pfirm}
                onChange={(e) => setPfirm(e.target.value)}
              />
              <Input
                label="Work email"
                icon={Mail}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
              {(
                [
                  [
                    'I certify I am an accredited investor',
                    accredited,
                    () => setAccredited((v) => !v)
                  ],
                  ['I agree to the non-disclosure agreement', nda, () => setNda((v) => !v)]
                ] as [string, boolean, () => void][]
              ).map(([copy, on, onToggle]) => (
                <button
                  key={copy}
                  type="button"
                  onClick={onToggle}
                  className={cn(
                    'flex items-center gap-2.5 rounded-[11px] border px-3 py-2.5 text-left',
                    on
                      ? 'border-[var(--success-line)] bg-[var(--success-soft)]'
                      : 'border-hairline bg-surface-1'
                  )}
                >
                  <span
                    className={cn(
                      'flex h-5 w-5 flex-none items-center justify-center rounded-md border',
                      on ? 'border-success bg-success text-white' : 'border-[var(--border-strong)]'
                    )}
                  >
                    {on && <Check size={13} strokeWidth={2.6} aria-hidden />}
                  </span>
                  <span className="text-[12.5px] text-fg-2">{copy}</span>
                </button>
              ))}
            </div>
            <Button
              variant="gold"
              size="lg"
              icon={CheckCircle2}
              className="mt-4 w-full"
              disabled={!ready}
              onClick={() => setStep('unlocked')}
            >
              Verify &amp; unlock
            </Button>
            <p className="mt-3 flex items-center justify-center gap-1.5 text-[10.5px] text-fg-5">
              <Info size={12} aria-hidden />
              Preview only — nothing is logged. Real recipients verify on your live link.
            </p>
          </div>
        ) : (
          <div className="p-6 text-center">
            <span className="mx-auto mb-3.5 flex h-[52px] w-[52px] items-center justify-center rounded-full border border-[var(--success-line)] bg-[var(--success-soft)] text-success">
              <Check size={26} strokeWidth={2.2} aria-hidden />
            </span>
            <div className="text-[16px] font-semibold tracking-[-0.01em] text-fg-1">
              Verified — {docName} unlocked
            </div>
            <div className="mx-auto mt-1.5 max-w-[36ch] text-[12.5px] text-fg-3">
              Welcome, {name}. The document opens watermarked, and access is logged for {firm} —
              this preview shows the flow without recording anything.
            </div>
            <div className="my-4 flex items-center gap-2.5 rounded-[12px] border border-hairline bg-surface-1 px-3.5 py-3 text-left">
              <FileText size={18} className="text-gold-1" aria-hidden />
              <div className="min-w-0 flex-1">
                <div className="text-[12.5px] font-semibold text-fg-1">{docName}</div>
                <div className="text-[10.5px] text-fg-5">
                  Watermarked · {name} · {pfirm}
                </div>
              </div>
              <Eye size={16} className="text-fg-4" aria-hidden />
            </div>
            <Button
              variant="primary"
              className="w-full"
              onClick={() => onVerify({ name, firm: pfirm })}
            >
              Done — close the preview
            </Button>
          </div>
        )}
      </div>
    </>
  );
}
