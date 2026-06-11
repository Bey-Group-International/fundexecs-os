'use client';

import { createElement, useEffect, useState, type ReactNode } from 'react';
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
  User,
  UserPlus,
  Users,
  X,
  type LucideIcon
} from 'lucide-react';
import {
  Avatar,
  Badge,
  Button,
  Card,
  Input,
  ProgressBar,
  SegTabs,
  type AvatarTone
} from '@/components/ui';
import { EarnCoin } from '@/components/screens/EarnCoin';
import { cn } from '@/lib/utils';
import {
  DR_ACCESS_0,
  DR_ACTIVITY_0,
  DR_INVITEES,
  DR_PROSPECTS,
  MATERIAL_BUILD,
  MAT_DOCS,
  MAT_LABEL,
  MAT_META,
  MAT_TONE,
  buildSteps,
  linkToken,
  materialDefaults,
  materialRows,
  type DataRoomAccess,
  type DataRoomActivity,
  type DataRoomProspect,
  type MaterialBuildCfg,
  type MaterialStage,
  type MaterialValue
} from '@/lib/dataroom/config';

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
  'file-plus': FilePlus,
  'user-plus': UserPlus
};
function icon(name: string): LucideIcon {
  return ICONS[name] ?? FileText;
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
  onBack,
  onComplete
}: {
  id: string;
  onBack: () => void;
  onComplete: () => void;
}) {
  const reduced = useReducedMotion() ?? false;
  const cfg: MaterialBuildCfg = MATERIAL_BUILD[id];
  const meta = MAT_META[id];
  const label = MAT_LABEL[id];
  const [d, setD] = useState<Record<string, MaterialValue>>(() => materialDefaults(cfg));
  const [applied, setApplied] = useState(false);
  const [phase, setPhase] = useState<'edit' | 'building' | 'done'>('edit');
  const [n, setN] = useState(0);
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

  if (phase === 'done') {
    return (
      <div className="mx-auto flex w-full max-w-[560px] flex-col items-center py-5">
        <span className="mb-3.5 flex h-14 w-14 items-center justify-center rounded-full border border-[var(--success-line)] bg-[var(--success-soft)] text-success">
          <Check size={28} strokeWidth={2.2} aria-hidden />
        </span>
        <h2 className="text-[20px] font-semibold tracking-[-0.015em] text-fg-1">{label} — ready</h2>
        <p className="mt-1.5 text-center text-[13px] text-fg-3">
          Built to your spec and placed in {meta.folder}. Review it, then add more — or go back and
          adjust.
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
              In {meta.folder}
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
          <Button variant="gold" iconRight={ArrowRight} onClick={onComplete}>
            Add to room &amp; continue
          </Button>
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
        <ProgressBar
          value={pct}
          gradient="linear-gradient(90deg,#F7C948,#E5A823)"
          height={6}
          ariaLabel="Build progress"
          className="w-full"
        />
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

/* ── the recipient vetting gate ──────────────────────────────────────────── */

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

  return (
    <>
      <div
        onClick={onClose}
        className="fixed inset-0 z-[60] bg-[rgba(3,6,12,0.7)] backdrop-blur-[3px]"
        aria-hidden
      />
      <div className="fixed left-1/2 top-1/2 z-[61] max-h-[88vh] w-[440px] max-w-[94vw] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-[20px] border border-[var(--border-strong)] bg-bg-2 shadow-[0_40px_90px_-30px_rgba(0,0,0,0.7)]">
        {step === 'verify' ? (
          <div className="p-6">
            <div className="mb-1 flex items-center gap-2.5">
              <EarnCoin size={22} className="flex-none" />
              <span className="text-[12px] font-semibold tracking-[-0.02em]">
                FundExecs <span className="font-medium text-fg-4">OS</span>
              </span>
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
                Verify your identity to unlock{' '}
                <span className="font-semibold text-fg-1">{docName}</span>. Access is logged and
                watermarked to you.
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
              <CheckCircle2 size={12} aria-hidden />
              This verification is recorded to the fund&apos;s Chain of Trust
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
              Welcome, {name}. The document is now open, watermarked to you, and your access has
              been logged for {firm}.
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
              Done — log my access
            </Button>
          </div>
        )}
      </div>
    </>
  );
}

/* ── the room ────────────────────────────────────────────────────────────── */

interface Viewer {
  name: string;
  firm: string;
  t: string;
}
interface DocLink {
  token: string;
  vetting: string;
  viewers: Viewer[];
}

export interface DataRoomFlowProps {
  firm: string;
}

export function DataRoomFlow({ firm }: DataRoomFlowProps) {
  const [view, setView] = useState<'materials' | 'room'>('materials');
  const [openMat, setOpenMat] = useState<string | null>(null);
  const [stages, setStages] = useState<Record<string, MaterialStage>>(() =>
    Object.fromEntries(MAT_DOCS.map((id) => [id, 'Draft' as MaterialStage]))
  );
  const [access, setAccess] = useState<DataRoomAccess[]>([...DR_ACCESS_0]);
  const [activity, setActivity] = useState<DataRoomActivity[]>([...DR_ACTIVITY_0]);
  const [invIdx, setInvIdx] = useState(0);
  const [links, setLinks] = useState<Record<string, DocLink>>({});
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

  function buildMaterial(id: string) {
    setStages((p) => ({ ...p, [id]: 'Ready' }));
    setActivity((a) => [
      {
        who: 'You',
        act: `added ${MAT_LABEL[id]} to ${MAT_META[id].folder}`,
        t: 'Just now',
        icon: 'file-plus'
      },
      ...a
    ]);
    setOpenMat(null);
    setView('room');
  }
  function generateLink(name: string) {
    setLinks((p) =>
      p[name]
        ? p
        : { ...p, [name]: { token: linkToken(), vetting: 'Accredited + NDA', viewers: [] } }
    );
    setActivity((a) => [
      { who: 'You', act: `generated a secure link for ${name}`, t: 'Just now', icon: 'link' },
      ...a
    ]);
  }
  function verifyViewer(name: string, who: { name: string; firm: string }) {
    setLinks((p) => ({
      ...p,
      [name]: { ...p[name], viewers: [...p[name].viewers, { ...who, t: 'Just now' }] }
    }));
    setActivity((a) => [
      { who: who.name, act: `was vetted & opened ${name}`, t: 'Just now', icon: 'shield-check' },
      ...a
    ]);
    setProspIdx((i) => i + 1);
    setGate(null);
  }
  function inviteLp() {
    const lp = DR_INVITEES[invIdx % DR_INVITEES.length];
    setAccess((a) => [
      ...a,
      { id: `${lp.id}${invIdx}`, name: lp.name, type: lp.type, status: 'Invited', tone: 'neutral' }
    ]);
    setActivity((a) => [
      { who: 'You', act: `invited ${lp.name}`, t: 'Just now', icon: 'user-plus' },
      ...a
    ]);
    setInvIdx((i) => i + 1);
  }

  if (openMat) {
    return (
      <MaterialBuilder
        key={openMat}
        id={openMat}
        onBack={() => setOpenMat(null)}
        onComplete={() => buildMaterial(openMat)}
      />
    );
  }

  const accessToneColor: Record<DataRoomAccess['tone'], string> = {
    success: 'var(--success)',
    azure: 'var(--accent)',
    neutral: 'var(--fg-4)'
  };

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
          <Badge tone="warning" className="ml-1 self-start text-[10px]">
            Illustrative
          </Badge>
        </div>
        <ProgressBar
          value={roomReady}
          gradient="linear-gradient(90deg,#F7C948,#E5A823)"
          height={6}
          ariaLabel="LP-ready materials"
          className="mt-3.5"
        />
      </Card>

      <SegTabs
        active={view}
        onChange={(id) => setView(id as 'materials' | 'room')}
        tabs={[
          { id: 'materials', label: 'Investor materials', icon: Files },
          { id: 'room', label: 'The data room', icon: FolderLock }
        ]}
      />

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
                      <Button variant="ghost" size="sm" icon={Eye}>
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
                {access.length} LPs with access · {readyCount} document{readyCount === 1 ? '' : 's'}{' '}
                · every view tracked to your Chain of Trust
              </div>
            </div>
            <Button variant="gold" size="sm" icon={UserPlus} onClick={inviteLp}>
              Invite an LP
            </Button>
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
                    const link = links[doc.name];
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
                              icon={Link2}
                              onClick={() => generateLink(doc.name)}
                            >
                              Generate link
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
                                onClick={() => setGate(doc.name)}
                              >
                                Open as recipient
                              </Button>
                            </div>
                            <div className="mt-2">
                              <div className="mb-1.5 text-[10.5px] text-fg-5">
                                {link.viewers.length
                                  ? `${link.viewers.length} ${link.viewers.length === 1 ? 'person has' : 'people have'} opened this link`
                                  : 'No one has opened this link yet'}
                              </div>
                              {link.viewers.map((v, i) => (
                                <div key={i} className="flex items-center gap-2.5 py-1.5">
                                  <Avatar name={v.name} size={24} tone="azure" />
                                  <div className="min-w-0 flex-1 truncate text-[12px] font-semibold text-fg-1">
                                    {v.name}{' '}
                                    <span className="font-normal text-fg-5">· {v.firm}</span>
                                  </div>
                                  <span className="inline-flex flex-none items-center gap-1 text-[10px] font-semibold text-success">
                                    <CheckCircle2 size={11} aria-hidden />
                                    Vetted
                                  </span>
                                  <span className="flex-none text-[10.5px] text-fg-5">{v.t}</span>
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
                eyebrow={`${access.length} LPs · scoped & tracked`}
              />
              <div className="flex flex-col gap-1.5">
                {access.map((lp) => (
                  <div
                    key={lp.id}
                    className="flex items-center gap-2.5 rounded-[12px] border border-hairline bg-surface-1 px-[13px] py-2.5"
                  >
                    <Avatar
                      name={lp.name}
                      size={30}
                      tone={(lp.tone === 'success' ? 'gold' : 'azure') as AvatarTone}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[12.5px] font-semibold text-fg-1">
                        {lp.name}
                      </div>
                      <div className="text-[10.5px] text-fg-5">{lp.type}</div>
                    </div>
                    <span
                      className="inline-flex flex-none items-center gap-1.5 text-[10.5px] font-semibold"
                      style={{ color: accessToneColor[lp.tone] }}
                    >
                      {lp.live && (
                        <span
                          className="h-1.5 w-1.5 rounded-full bg-success motion-safe:animate-pulse"
                          aria-hidden
                        />
                      )}
                      {lp.status}
                    </span>
                  </div>
                ))}
              </div>
            </Card>
          </div>

          <Card className="p-[18px]">
            <PanelHeader
              icon={Activity}
              title="Room activity"
              eyebrow="Every interaction, on the record"
            />
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
                  <span className="flex-none text-[11px] text-fg-5">{a.t}</span>
                </div>
              ))}
            </div>
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
          docName={gate}
          firm={firm}
          prospect={DR_PROSPECTS[prospIdx % DR_PROSPECTS.length]}
          onClose={() => setGate(null)}
          onVerify={(who) => verifyViewer(gate, who)}
        />
      )}
    </div>
  );
}

export default DataRoomFlow;
