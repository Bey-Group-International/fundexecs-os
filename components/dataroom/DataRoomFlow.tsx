'use client';

import { createElement, useEffect, useRef, useState, type ReactNode } from 'react';
import { useReducedMotion } from 'motion/react';
import {
  Activity,
  ArrowLeft,
  ArrowRight,
  Building2,
  Calculator,
  Check,
  CheckCircle2,
  ClipboardList,
  Download,
  ExternalLink,
  Eye,
  FilePlus,
  FileText,
  Files,
  FolderLock,
  Hand,
  Info,
  Link2,
  Loader2,
  Mail,
  Presentation,
  Sparkles,
  TrendingUp,
  TriangleAlert,
  User,
  Users,
  X,
  type LucideIcon
} from 'lucide-react';
import { Avatar, type AvatarTone } from '@/components/ui/Avatar';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { EarnCoin } from '@/components/ui/EarnCoin';
import { Input } from '@/components/ui/Input';
import { ProgressBar } from '@/components/ui/ProgressBar';
import { SegTabs } from '@/components/ui/Tabs';
import { buildMaterial, generateMaterialLink } from '@/lib/dataroom/actions';
import {
  DR_PROSPECTS,
  MATERIAL_BUILD,
  MAT_DOCS,
  MAT_LABEL,
  MAT_META,
  MAT_TONE,
  buildSteps,
  materialDefaults,
  materialRows,
  type DataRoomProspect,
  type MaterialBuildCfg,
  type MaterialStage,
  type MaterialValue
} from '@/lib/dataroom/config';
import type { DataRoomActivityItem, DataRoomLinkState } from '@/lib/queries/data-room';
import { cn } from '@/lib/utils';

/* ── icon resolvers ──────────────────────────────────────────────────────── */
const ICONS: Record<string, LucideIcon> = {
  presentation: Presentation,
  'file-text': FileText,
  'clipboard-list': ClipboardList,
  'trending-up': TrendingUp,
  calculator: Calculator,
  mail: Mail,
  eye: Eye,
  download: Download,
  'share-2': Link2,
  link: Link2,
  'shield-check': CheckCircle2,
  'file-plus': FilePlus
};
function icon(name: string): LucideIcon {
  return ICONS[name] ?? FileText;
}

/** Compact relative time for the activity feed ("just now", "2h ago"…). */
function relTime(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms) || ms < 60_000) return 'Just now';
  const m = Math.floor(ms / 60_000);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return d < 7 ? `${d}d ago` : new Date(iso).toLocaleDateString();
}

function Chip({
  label,
  selected,
  onClick
}: {
  label: string;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[12.5px] font-medium transition',
        selected
          ? 'border-[var(--accent-line)] bg-[var(--accent-soft)] text-fg-1'
          : 'border-hairline bg-surface-1 text-fg-3 hover:bg-surface-2'
      )}
    >
      {selected && <Check size={12} strokeWidth={2.4} aria-hidden />}
      {label}
    </button>
  );
}

function Eyebrow({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={cn('text-[10.5px] font-semibold uppercase tracking-[0.11em] text-fg-4', className)}
    >
      {children}
    </div>
  );
}

function PanelHeader({
  icon: Ico,
  title,
  eyebrow,
  action
}: {
  icon: LucideIcon;
  title: string;
  eyebrow: string;
  action?: ReactNode;
}) {
  return (
    <div className="mb-3 flex items-start justify-between gap-3">
      <div className="flex items-center gap-2.5">
        <span className="flex h-[30px] w-[30px] flex-none items-center justify-center rounded-[9px] border border-hairline bg-surface-2 text-fg-3">
          <Ico size={16} strokeWidth={1.9} aria-hidden />
        </span>
        <div>
          <Eyebrow className="mb-px">{eyebrow}</Eyebrow>
          <div className="text-[14.5px] font-semibold tracking-[-0.01em] text-fg-1">{title}</div>
        </div>
      </div>
      {action}
    </div>
  );
}

/* ── the copiloted material builder ──────────────────────────────────────── */

function MaterialBuilder({
  id,
  initialSpec,
  alreadyReady,
  onBack,
  onBuilt
}: {
  id: string;
  /** Persisted spec when re-opening a built material. */
  initialSpec: Record<string, MaterialValue> | null;
  alreadyReady: boolean;
  onBack: () => void;
  onBuilt: (id: string, spec: Record<string, MaterialValue>) => void;
}) {
  const reduced = useReducedMotion() ?? false;
  const cfg: MaterialBuildCfg = MATERIAL_BUILD[id];
  const meta = MAT_META[id];
  const label = MAT_LABEL[id];
  const [d, setD] = useState<Record<string, MaterialValue>>(
    () => initialSpec ?? materialDefaults(cfg)
  );
  const [applied, setApplied] = useState(false);
  const [phase, setPhase] = useState<'edit' | 'building' | 'done'>(alreadyReady ? 'done' : 'edit');
  const [n, setN] = useState(0);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const steps = buildSteps(id);

  const set = (k: string, v: MaterialValue) => setD((p) => ({ ...p, [k]: v }));
  const toggle = (k: string, v: string) =>
    setD((p) => {
      const cur = (p[k] as string[]) ?? [];
      return { ...p, [k]: cur.includes(v) ? cur.filter((x) => x !== v) : [...cur, v] };
    });

  useEffect(() => {
    if (phase !== 'building') return;
    if (reduced) {
      const t = setTimeout(() => setPhase('done'), 300);
      return () => clearTimeout(t);
    }
    let i = 0;
    const timer = setInterval(() => {
      i += 1;
      setN(i);
      if (i >= steps.length) {
        clearInterval(timer);
        setTimeout(() => setPhase('done'), 450);
      }
    }, 600);
    return () => clearInterval(timer);
  }, [phase, reduced, steps.length]);

  async function addToRoom() {
    setSaving(true);
    setSaveError(null);
    try {
      const res = await buildMaterial(id, d);
      if (res.ok) onBuilt(id, d);
      else setSaveError(res.error);
    } catch {
      setSaveError('Could not save — check your connection and try again.');
    } finally {
      setSaving(false);
    }
  }

  if (phase === 'done') {
    return (
      <div className="mx-auto flex w-full max-w-[560px] flex-col items-center py-5">
        <span className="mb-3.5 flex h-14 w-14 items-center justify-center rounded-full border border-[var(--success-line)] bg-[var(--success-soft)] text-success">
          <Check size={28} strokeWidth={2.2} aria-hidden />
        </span>
        <h2 className="text-[20px] font-semibold tracking-[-0.015em] text-fg-1">
          {label} — {alreadyReady ? 'in the room' : 'ready'}
        </h2>
        <p className="mt-1.5 text-center text-[13px] text-fg-3">
          {alreadyReady
            ? `Live in ${meta.folder}. Adjust the spec and rebuild anytime.`
            : `Built to your spec for ${meta.folder}. Add it to the room, or go back and adjust.`}
        </p>
        <div className="mt-4 w-full overflow-hidden rounded-[14px] border border-hairline">
          <div className="flex items-center gap-2.5 border-b border-hairline bg-surface-1 px-[15px] py-2.5">
            {createElement(icon(meta.icon), {
              size: 15,
              className: 'text-gold-1',
              'aria-hidden': true
            })}
            <span className="text-[12.5px] font-semibold text-fg-1">{label}</span>
            <span className="flex-1" />
            <span className="inline-flex items-center gap-1.5 text-[10.5px] font-semibold text-success">
              <FolderLock size={12} aria-hidden />
              {meta.folder}
            </span>
          </div>
          {materialRows(cfg, d).map(([k, v], i) => (
            <div
              key={k}
              className={cn(
                'flex gap-3.5 px-[15px] py-2.5',
                i % 2 === 0 ? 'bg-surface-1' : 'bg-transparent',
                i > 0 && 'border-t border-[var(--border-faint)]'
              )}
            >
              <span className="w-[130px] flex-none text-[12px] text-fg-4">{k}</span>
              <span className="text-[13px] font-medium text-fg-1">{v}</span>
            </div>
          ))}
        </div>
        {saveError && (
          <div className="mt-3 flex w-full items-center gap-2.5 rounded-xl border border-[var(--danger-line)] bg-[var(--danger-soft)] px-3.5 py-2.5 text-[12.5px] text-danger">
            <TriangleAlert size={15} aria-hidden />
            {saveError}
          </div>
        )}
        <div className="mt-5 flex w-full flex-wrap items-center justify-between gap-2.5">
          <Button
            variant="ghost"
            icon={ArrowLeft}
            onClick={() => {
              setPhase('edit');
              setN(0);
            }}
          >
            Go back &amp; edit
          </Button>
          {alreadyReady ? (
            <Button variant="outline" iconRight={Check} onClick={onBack}>
              Close
            </Button>
          ) : (
            <Button
              variant="gold"
              icon={saving ? Loader2 : undefined}
              iconRight={saving ? undefined : ArrowRight}
              disabled={saving}
              onClick={() => void addToRoom()}
            >
              {saving ? 'Adding…' : 'Add to room & continue'}
            </Button>
          )}
        </div>
      </div>
    );
  }

  if (phase === 'building') {
    const pct = Math.round((n / steps.length) * 100);
    return (
      <div className="mx-auto flex w-full max-w-[540px] flex-col items-center py-6">
        <div className="mb-4 flex flex-col items-center text-center">
          <div className="relative mb-3">
            <span
              aria-hidden
              className="absolute -inset-2.5 rounded-full motion-safe:animate-pulse"
              style={{
                background: 'radial-gradient(circle, rgba(247,201,72,0.5), transparent 70%)',
                filter: 'blur(8px)'
              }}
            />
            <EarnCoin size={52} className="relative" />
          </div>
          <h2 className="text-[19px] font-semibold tracking-[-0.015em] text-fg-1">
            Building {label}…
          </h2>
          <p className="mt-1.5 text-[12.5px] text-fg-3">
            Drafting from your fund story to the spec you set.
          </p>
        </div>
        <ProgressBar value={pct} height={6} label="Build progress" className="w-full" />
        <Card className="mt-3.5 flex w-full flex-col gap-0.5 p-3">
          {steps.map((s, i) =>
            i <= n ? (
              <div key={s} className="flex items-center gap-2.5 px-2 py-2">
                <span
                  className={cn(
                    'flex h-[22px] w-[22px] flex-none items-center justify-center rounded-full border',
                    i < n
                      ? 'border-[var(--success-line)] bg-[var(--success-soft)] text-success'
                      : 'border-hairline bg-surface-2 text-fg-4'
                  )}
                >
                  {i < n ? (
                    <Check size={12} strokeWidth={2.4} aria-hidden />
                  ) : (
                    <Loader2 size={12} className="motion-safe:animate-spin" aria-hidden />
                  )}
                </span>
                <span className={cn('text-[13px]', i < n ? 'text-fg-2' : 'text-fg-1')}>{s}</span>
              </div>
            ) : null
          )}
        </Card>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-3">
        <Button variant="outline" size="sm" icon={ArrowLeft} onClick={onBack}>
          Materials
        </Button>
        <div className="min-w-0 flex-1">
          <h1 className="text-[18px] font-semibold tracking-[-0.015em] text-fg-1">{label}</h1>
          <p className="text-[12px] text-fg-4">
            You shape it, Earn drafts it · lands in {meta.folder}
          </p>
        </div>
        <Badge tone="azure" dot>
          Copiloted
        </Badge>
      </div>
      <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-[minmax(0,1fr)_300px]">
        <Card className="p-6">
          <p className="mb-4 text-[12.5px] leading-relaxed text-fg-4">{cfg.intro}</p>
          <div className="flex flex-col gap-5">
            {cfg.decisions.map((dec) => (
              <div key={dec.key}>
                <Eyebrow className="mb-2">
                  {dec.label}
                  {dec.kind === 'multi' && (
                    <span className="font-normal normal-case tracking-normal text-fg-5">
                      {' '}
                      · pick any
                    </span>
                  )}
                </Eyebrow>
                <div className="flex flex-wrap gap-2">
                  {dec.opts.map((o) => (
                    <Chip
                      key={o}
                      label={o}
                      selected={
                        dec.kind === 'multi'
                          ? ((d[dec.key] as string[]) ?? []).includes(o)
                          : d[dec.key] === o
                      }
                      onClick={() => (dec.kind === 'multi' ? toggle(dec.key, o) : set(dec.key, o))}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
          <div className="mt-6 flex flex-wrap items-center justify-between gap-2.5">
            <Button variant="ghost" icon={ArrowLeft} onClick={onBack}>
              Cancel
            </Button>
            <Button
              variant="gold"
              iconRight={Sparkles}
              onClick={() => {
                setN(0);
                setPhase('building');
              }}
            >
              Build &amp; add to room
            </Button>
          </div>
        </Card>
        <Card className="self-start p-[17px]">
          <div className="mb-3 flex items-center gap-2.5">
            <EarnCoin size={32} online className="flex-none" />
            <div>
              <div className="text-[13px] font-semibold text-fg-1">Earn</div>
              <div className="text-[10.5px] text-fg-4">{meta.cat} copilot</div>
            </div>
          </div>
          <Eyebrow className="mb-1.5 text-gold-1">Earn recommends</Eyebrow>
          <p className="text-[12.5px] leading-relaxed text-fg-2">{cfg.recText}</p>
          <Button
            variant={applied ? 'secondary' : 'gold'}
            size="sm"
            icon={applied ? Check : Sparkles}
            className="mt-3.5 w-full"
            onClick={() => {
              setD(materialDefaults(cfg));
              setApplied(true);
            }}
          >
            {applied ? 'Recommendation applied' : "Apply Earn's recommendation"}
          </Button>
          <p className="mt-3 flex items-center gap-1.5 text-[11px] text-fg-5">
            <Hand size={12} aria-hidden />
            You&apos;re in control — change anything.
          </p>
        </Card>
      </div>
    </div>
  );
}

/* ── the recipient vetting gate (a labelled preview of the LP experience) ── */

const VETTING_FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function VettingGate({
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
              Preview only — nothing is logged until the public link route is live
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

/* ── the room ────────────────────────────────────────────────────────────── */

interface PreviewViewer {
  name: string;
  firm: string;
}
interface DocLink {
  token: string;
  vetting: string;
  /** Real logged views (from data_room_views). */
  viewers: { name: string; verifiedAt: string | null }[];
  /** Session-only recipient previews — never persisted. */
  previews: PreviewViewer[];
}

export interface DataRoomFlowProps {
  firm: string;
  initialStages: Record<string, MaterialStage>;
  initialSpecs: Record<string, Record<string, MaterialValue>>;
  initialLinks: Record<string, DataRoomLinkState>;
  initialActivity: DataRoomActivityItem[];
}

export function DataRoomFlow({
  firm,
  initialStages,
  initialSpecs,
  initialLinks,
  initialActivity
}: DataRoomFlowProps) {
  const [view, setView] = useState<'materials' | 'room'>('materials');
  const [openMat, setOpenMat] = useState<string | null>(null);
  const [stages, setStages] = useState<Record<string, MaterialStage>>(initialStages);
  const [specs, setSpecs] = useState(initialSpecs);
  const [activity, setActivity] = useState<DataRoomActivityItem[]>(initialActivity);
  const [links, setLinks] = useState<Record<string, DocLink>>(() =>
    Object.fromEntries(Object.entries(initialLinks).map(([id, l]) => [id, { ...l, previews: [] }]))
  );
  const [linkPending, setLinkPending] = useState<string | null>(null);
  const [linkError, setLinkError] = useState<string | null>(null);
  const [gate, setGate] = useState<string | null>(null);
  const [prospIdx, setProspIdx] = useState(0);

  const readyCount = MAT_DOCS.filter((id) => stages[id] === 'Ready').length;
  const roomReady = Math.round((readyCount / MAT_DOCS.length) * 100);
  const roomDocs = MAT_DOCS.filter((id) => stages[id] === 'Ready').map((id) => ({
    key: id,
    name: MAT_LABEL[id],
    folder: MAT_META[id].folder,
    icon: MAT_META[id].icon
  }));
  // Everyone who has actually been through a link (real views, all docs).
  const realViewers = Object.values(links).flatMap((l) => l.viewers);

  function logActivity(who: string, act: string, ic: string) {
    setActivity((a) => [{ who, act, at: new Date().toISOString(), icon: ic }, ...a]);
  }

  function onBuilt(id: string, spec: Record<string, MaterialValue>) {
    setStages((p) => ({ ...p, [id]: 'Ready' }));
    setSpecs((p) => ({ ...p, [id]: spec }));
    logActivity('You', `added ${MAT_LABEL[id]} to ${MAT_META[id].folder}`, 'file-plus');
    setOpenMat(null);
    setView('room');
  }

  function generateLink(id: string) {
    const name = MAT_LABEL[id];
    setLinkPending(id);
    setLinkError(null);
    generateMaterialLink(id)
      .then((res) => {
        if (res.ok && res.token) {
          setLinks((p) => ({
            ...p,
            [id]: { token: res.token!, vetting: 'Accredited + NDA', viewers: [], previews: [] }
          }));
          logActivity('You', `generated a secure link for ${name}`, 'link');
        } else if (!res.ok) {
          setLinkError(res.error);
        }
      })
      .catch(() => setLinkError('Could not generate the link — try again.'))
      .finally(() => setLinkPending(null));
  }

  function previewViewer(id: string, who: PreviewViewer) {
    setLinks((p) => ({ ...p, [id]: { ...p[id], previews: [...p[id].previews, who] } }));
    setProspIdx((i) => i + 1);
    setGate(null);
  }

  if (openMat) {
    return (
      <MaterialBuilder
        key={openMat}
        id={openMat}
        initialSpec={specs[openMat] ?? null}
        alreadyReady={stages[openMat] === 'Ready'}
        onBack={() => setOpenMat(null)}
        onBuilt={onBuilt}
      />
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <Card className="p-5">
        <div className="flex items-center gap-3">
          <span className="flex h-11 w-11 flex-none items-center justify-center rounded-[12px] border border-[var(--accent-line)] bg-[var(--accent-soft)] text-[var(--accent)]">
            <FolderLock size={22} strokeWidth={1.9} aria-hidden />
          </span>
          <div className="min-w-0 flex-1">
            <h1 className="text-[19px] font-semibold tracking-[-0.015em] text-fg-1">
              Materials &amp; data room
            </h1>
            <p className="mt-0.5 text-[12.5px] text-fg-3">
              Everything an LP asks for — generated by the team, served from one secure room.
            </p>
          </div>
          <div className="flex-none text-right">
            <div className="text-[22px] font-semibold tabular-nums text-gold-1">
              {readyCount}/{MAT_DOCS.length}
            </div>
            <div className="text-[10.5px] text-fg-5">LP-ready</div>
          </div>
        </div>
        <ProgressBar value={roomReady} height={6} label="LP-ready materials" className="mt-3.5" />
      </Card>

      <SegTabs
        active={view}
        onChange={(id) => setView(id as 'materials' | 'room')}
        tabs={[
          { id: 'materials', label: 'Investor materials', icon: Files },
          { id: 'room', label: 'The data room', icon: FolderLock }
        ]}
      />

      {linkError && (
        <div className="flex items-center gap-2.5 rounded-xl border border-[var(--danger-line)] bg-[var(--danger-soft)] px-3.5 py-2.5 text-[12.5px] text-danger">
          <TriangleAlert size={15} aria-hidden />
          {linkError}
        </div>
      )}

      {view === 'materials' ? (
        <Card className="p-[18px]">
          <PanelHeader
            icon={Files}
            title="Investor materials"
            eyebrow="The documents formation doesn't build · drafted from your fund story"
          />
          <div className="mb-3 flex items-start gap-2.5 rounded-[11px] border border-[var(--border-faint)] bg-surface-1 px-3.5 py-2.5">
            <Info size={14} className="mt-px flex-none text-gold-1" aria-hidden />
            <span className="text-[11.5px] leading-relaxed text-fg-4">
              Your legal set — LPA, PPM, subscription docs, Form D — is built in{' '}
              <span className="font-semibold text-fg-2">Formation</span> and flows into the room
              automatically. Build the investor-facing materials here.
            </span>
          </div>
          <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
            {MAT_DOCS.map((id) => {
              const meta = MAT_META[id];
              const ready = stages[id] === 'Ready';
              return (
                <div
                  key={id}
                  className="flex flex-col rounded-[12px] border border-hairline bg-surface-1 p-3.5"
                >
                  <div className="flex items-center gap-2.5">
                    <span
                      className={cn(
                        'flex h-[34px] w-[34px] flex-none items-center justify-center rounded-[9px] border',
                        ready
                          ? 'border-[var(--success-line)] bg-[var(--success-soft)] text-success'
                          : 'border-hairline bg-surface-2 text-fg-3'
                      )}
                    >
                      {createElement(icon(meta.icon), {
                        size: 17,
                        strokeWidth: 1.9,
                        'aria-hidden': true
                      })}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[13px] font-semibold text-fg-1">
                        {MAT_LABEL[id]}
                      </div>
                      <div className="text-[10.5px] text-fg-5">
                        {meta.cat} · {meta.fmt}
                      </div>
                    </div>
                  </div>
                  <div className="mt-3 flex items-center gap-2">
                    <Badge tone={MAT_TONE[stages[id]]} className="text-[9.5px]">
                      {stages[id]}
                    </Badge>
                    <span className="flex-1" />
                    {ready ? (
                      <Button variant="ghost" size="sm" icon={Eye} onClick={() => setOpenMat(id)}>
                        Open
                      </Button>
                    ) : (
                      <Button
                        variant="secondary"
                        size="sm"
                        icon={Sparkles}
                        onClick={() => setOpenMat(id)}
                      >
                        Build
                      </Button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </Card>
      ) : (
        <div className="flex flex-col gap-4">
          <Card className="flex flex-wrap items-center gap-3 border-[var(--gold-line)] bg-[linear-gradient(100deg,rgba(247,201,72,0.10),transparent_60%)] p-[15px] px-[18px]">
            <span
              className="h-2.5 w-2.5 flex-none rounded-full bg-success motion-safe:animate-pulse"
              aria-hidden
            />
            <div className="min-w-0 flex-1">
              <div className="text-[13.5px] font-semibold text-fg-1">Your data room is live</div>
              <div className="text-[11.5px] text-fg-4">
                {readyCount} document{readyCount === 1 ? '' : 's'} · {Object.keys(links).length}{' '}
                vetted link
                {Object.keys(links).length === 1 ? '' : 's'} · every view logged on the record
              </div>
            </div>
          </Card>

          <div className="grid grid-cols-1 items-start gap-3.5 lg:grid-cols-2">
            <Card className="p-[18px]">
              <PanelHeader
                icon={FolderLock}
                title="Documents"
                eyebrow="Generate a vetted, unique link per document"
              />
              {roomDocs.length === 0 ? (
                <p className="px-0.5 py-2 text-[12px] text-fg-5">
                  No documents yet — build a material to add it here.
                </p>
              ) : (
                <div className="flex flex-col gap-2">
                  {roomDocs.map((doc) => {
                    const link = links[doc.key];
                    return (
                      <div
                        key={doc.key}
                        className="rounded-[12px] border border-hairline bg-surface-1 px-[13px] py-2.5"
                      >
                        <div className="flex items-center gap-2.5">
                          <span className="flex h-[30px] w-[30px] flex-none items-center justify-center rounded-lg border border-hairline bg-surface-2 text-fg-3">
                            {createElement(icon(doc.icon), {
                              size: 15,
                              strokeWidth: 1.9,
                              'aria-hidden': true
                            })}
                          </span>
                          <div className="min-w-0 flex-1">
                            <div className="truncate text-[12.5px] font-semibold text-fg-1">
                              {doc.name}
                            </div>
                            <div className="text-[10.5px] text-fg-5">{doc.folder} · Built here</div>
                          </div>
                          {link ? (
                            <span className="inline-flex flex-none items-center gap-1.5 text-[10.5px] font-semibold text-success">
                              <CheckCircle2 size={12} aria-hidden />
                              Link live
                            </span>
                          ) : (
                            <Button
                              variant="secondary"
                              size="sm"
                              icon={linkPending === doc.key ? Loader2 : Link2}
                              disabled={linkPending === doc.key}
                              onClick={() => generateLink(doc.key)}
                            >
                              {linkPending === doc.key ? 'Generating…' : 'Generate link'}
                            </Button>
                          )}
                        </div>
                        {link && (
                          <div className="mt-2.5 border-t border-[var(--border-faint)] pt-2.5">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="rounded-[7px] border border-[var(--accent-line)] bg-[var(--accent-soft)] px-2 py-0.5 font-mono text-[11px] text-[var(--accent)]">
                                fundexecs.io/dr/{link.token}
                              </span>
                              <span className="inline-flex items-center gap-1 text-[10.5px] text-fg-4">
                                <CheckCircle2 size={12} className="text-gold-1" aria-hidden />
                                Vets: {link.vetting}
                              </span>
                              <span className="flex-1" />
                              <Button
                                variant="ghost"
                                size="sm"
                                icon={ExternalLink}
                                onClick={() => setGate(doc.key)}
                              >
                                Preview as recipient
                              </Button>
                            </div>
                            <div className="mt-2">
                              <div className="mb-1.5 text-[10.5px] text-fg-5">
                                {link.viewers.length
                                  ? `${link.viewers.length} ${link.viewers.length === 1 ? 'person has' : 'people have'} opened this link`
                                  : 'No one has opened this link yet'}
                              </div>
                              {link.viewers.map((v, i) => (
                                <div key={`v${i}`} className="flex items-center gap-2.5 py-1.5">
                                  <Avatar name={v.name} size={24} tone="azure" />
                                  <div className="min-w-0 flex-1 truncate text-[12px] font-semibold text-fg-1">
                                    {v.name}
                                  </div>
                                  <span className="inline-flex flex-none items-center gap-1 text-[10px] font-semibold text-success">
                                    <CheckCircle2 size={11} aria-hidden />
                                    Vetted
                                  </span>
                                  {v.verifiedAt && (
                                    <span className="flex-none text-[10.5px] text-fg-5">
                                      {relTime(v.verifiedAt)}
                                    </span>
                                  )}
                                </div>
                              ))}
                              {link.previews.map((v, i) => (
                                <div key={`p${i}`} className="flex items-center gap-2.5 py-1.5">
                                  <Avatar name={v.name} size={24} tone="neutral" />
                                  <div className="min-w-0 flex-1 truncate text-[12px] font-semibold text-fg-2">
                                    {v.name}{' '}
                                    <span className="font-normal text-fg-5">· {v.firm}</span>
                                  </div>
                                  <span className="flex-none text-[10px] font-semibold uppercase tracking-[0.06em] text-warning">
                                    Preview
                                  </span>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </Card>

            <Card className="p-[18px]">
              <PanelHeader
                icon={Users}
                title="Who has access"
                eyebrow="Vetted recipients · scoped & tracked"
              />
              {realViewers.length === 0 ? (
                <p className="px-0.5 py-2 text-[12px] leading-relaxed text-fg-5">
                  No LPs have been through a link yet. Share a vetted link and every recipient
                  appears here the moment they verify — accredited + NDA, logged and watermarked.
                </p>
              ) : (
                <div className="flex flex-col gap-1.5">
                  {realViewers.map((v, i) => (
                    <div
                      key={i}
                      className="flex items-center gap-2.5 rounded-[12px] border border-hairline bg-surface-1 px-[13px] py-2.5"
                    >
                      <Avatar name={v.name} size={30} tone={'azure' as AvatarTone} />
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-[12.5px] font-semibold text-fg-1">
                          {v.name}
                        </div>
                        <div className="text-[10.5px] text-fg-5">
                          Vetted{v.verifiedAt ? ` · ${relTime(v.verifiedAt)}` : ''}
                        </div>
                      </div>
                      <span className="inline-flex flex-none items-center gap-1 text-[10px] font-semibold text-success">
                        <CheckCircle2 size={11} aria-hidden />
                        Verified
                      </span>
                    </div>
                  ))}
                </div>
              )}
              <p className="mt-3 flex items-center gap-1.5 text-[10.5px] text-fg-5">
                <Info size={12} aria-hidden />
                LP invitations come online with the public link route.
              </p>
            </Card>
          </div>

          <Card className="p-[18px]">
            <PanelHeader
              icon={Activity}
              title="Room activity"
              eyebrow="Every interaction, on the record"
            />
            {activity.length === 0 ? (
              <p className="px-0.5 py-2 text-[12px] text-fg-5">
                Quiet so far — build a material or generate a link and it logs here.
              </p>
            ) : (
              <div className="flex flex-col">
                {activity.map((a, i) => (
                  <div
                    key={i}
                    className={cn(
                      'flex items-center gap-2.5 py-2',
                      i > 0 && 'border-t border-[var(--border-faint)]'
                    )}
                  >
                    <span className="flex h-7 w-7 flex-none items-center justify-center rounded-lg border border-hairline bg-surface-2 text-fg-3">
                      {createElement(icon(a.icon), {
                        size: 14,
                        strokeWidth: 1.9,
                        'aria-hidden': true
                      })}
                    </span>
                    <div className="min-w-0 flex-1 text-[12.5px] text-fg-2">
                      <span className="font-semibold text-fg-1">{a.who}</span> {a.act}
                    </div>
                    <span className="flex-none text-[11px] text-fg-5">{relTime(a.at)}</span>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>
      )}

      <Card className="flex items-center gap-3 border-[var(--gold-line)] bg-[var(--gold-soft)] p-[14px] px-4">
        <EarnCoin size={26} className="flex-none" />
        <p className="flex-1 text-[12.5px] leading-relaxed text-fg-2">
          <span className="font-semibold text-gold-1">Earn:</span> I draft every document from your
          fund story and keep the room current. Finalize a material and it lands in the right folder
          automatically.
        </p>
      </Card>

      {gate && (
        <VettingGate
          docName={MAT_LABEL[gate]}
          firm={firm}
          prospect={DR_PROSPECTS[prospIdx % DR_PROSPECTS.length]}
          onClose={() => setGate(null)}
          onVerify={(who) => previewViewer(gate, who)}
        />
      )}
    </div>
  );
}
