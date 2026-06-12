'use client';

import { createElement, useState, useSyncExternalStore } from 'react';
import {
  Activity,
  CheckCircle2,
  Copy,
  ExternalLink,
  Eye,
  Files,
  FolderLock,
  Info,
  Link2,
  LinkIcon,
  Loader2,
  Sparkles,
  TriangleAlert,
  Users
} from 'lucide-react';
import { Avatar, type AvatarTone } from '@/components/ui/Avatar';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { EarnCoin } from '@/components/ui/EarnCoin';
import { ProgressBar } from '@/components/ui/ProgressBar';
import { Select } from '@/components/ui/Select';
import { SegTabs } from '@/components/ui/Tabs';
import { generateMaterialLink, revokeMaterialLink } from '@/lib/dataroom/actions';
import {
  DEFAULT_LINK_EXPIRY,
  DR_PROSPECTS,
  LINK_EXPIRY_PRESETS,
  MAT_DOCS,
  MAT_LABEL,
  MAT_META,
  MAT_TONE,
  expiryTimestamp,
  type MaterialStage,
  type MaterialValue
} from '@/lib/dataroom/config';
import type { DataRoomActivityItem, DataRoomLinkState } from '@/lib/queries/data-room';
import { cn } from '@/lib/utils';
import { MaterialBuilder } from './MaterialBuilder';
import { VettingGate } from './VettingGate';
import { PanelHeader, icon, relTime } from './shared';

/* ── the room ────────────────────────────────────────────────────────────── */

// The share host is only knowable in the browser (the room serves from
// whatever domain the operator is on); hydrate from '' to avoid a mismatch.
const noopSubscribe = () => () => {};
const hostSnapshot = () => window.location.host;
const serverHostSnapshot = () => '';

interface PreviewViewer {
  name: string;
  firm: string;
}
interface DocLink {
  token: string;
  vetting: string;
  /** Set when the link has an expiry; in the past = revoked/expired. */
  expiresAt: string | null;
  expired: boolean;
  /** Real logged views (from data_room_views). */
  viewers: { name: string; email: string | null; verifiedAt: string | null }[];
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
  const [expiryChoice, setExpiryChoice] = useState<Record<string, string>>({});
  const [copied, setCopied] = useState<string | null>(null);
  const [gate, setGate] = useState<string | null>(null);
  const [prospIdx, setProspIdx] = useState(0);
  const host = useSyncExternalStore(noopSubscribe, hostSnapshot, serverHostSnapshot);

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
    const expiry = expiryChoice[id] ?? DEFAULT_LINK_EXPIRY;
    setLinkPending(id);
    setLinkError(null);
    generateMaterialLink(id, expiry)
      .then((res) => {
        if (res.ok && res.token) {
          setLinks((p) => ({
            ...p,
            [id]: {
              token: res.token!,
              vetting: 'Accredited + NDA',
              expiresAt: expiryTimestamp(expiry),
              expired: false,
              viewers: p[id]?.viewers ?? [],
              previews: []
            }
          }));
          logActivity('You', `generated a secure link for ${name}`, 'link');
        } else if (!res.ok) {
          setLinkError(res.error);
        }
      })
      .catch(() => setLinkError('Could not generate the link — try again.'))
      .finally(() => setLinkPending(null));
  }

  function revokeLink(id: string) {
    const name = MAT_LABEL[id];
    setLinkPending(id);
    setLinkError(null);
    revokeMaterialLink(id)
      .then((res) => {
        if (res.ok) {
          setLinks((p) => ({
            ...p,
            [id]: { ...p[id], expired: true, expiresAt: new Date().toISOString() }
          }));
          logActivity('You', `revoked the secure link for ${name}`, 'link');
        } else {
          setLinkError(res.error);
        }
      })
      .catch(() => setLinkError('Could not revoke the link — try again.'))
      .finally(() => setLinkPending(null));
  }

  function copyLink(id: string, token: string) {
    if (!navigator.clipboard) return;
    navigator.clipboard
      .writeText(`${window.location.origin}/dr/${token}`)
      .then(() => {
        setCopied(id);
        window.setTimeout(() => setCopied((c) => (c === id ? null : c)), 2000);
      })
      .catch(() => {});
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
                          {link && !link.expired ? (
                            <span className="inline-flex flex-none items-center gap-1.5 text-[10.5px] font-semibold text-success">
                              <CheckCircle2 size={12} aria-hidden />
                              Link live
                              {link.expiresAt && (
                                <span className="font-normal text-fg-5">
                                  · expires {new Date(link.expiresAt).toLocaleDateString()}
                                </span>
                              )}
                            </span>
                          ) : (
                            <span className="flex flex-none items-center gap-2">
                              {link?.expired && (
                                <span className="inline-flex items-center gap-1 text-[10.5px] font-semibold text-warning">
                                  <TriangleAlert size={12} aria-hidden />
                                  Revoked
                                </span>
                              )}
                              <Select
                                aria-label={`Link expiry for ${doc.name}`}
                                options={LINK_EXPIRY_PRESETS.map((pr) => ({
                                  value: pr.id,
                                  label: pr.label
                                }))}
                                value={expiryChoice[doc.key] ?? DEFAULT_LINK_EXPIRY}
                                onChange={(e) =>
                                  setExpiryChoice((p) => ({ ...p, [doc.key]: e.target.value }))
                                }
                                className="w-auto py-1.5 text-[11.5px]"
                              />
                              <Button
                                variant="secondary"
                                size="sm"
                                icon={linkPending === doc.key ? Loader2 : Link2}
                                disabled={linkPending === doc.key}
                                onClick={() => generateLink(doc.key)}
                              >
                                {linkPending === doc.key
                                  ? 'Generating…'
                                  : link?.expired
                                    ? 'New link'
                                    : 'Generate link'}
                              </Button>
                            </span>
                          )}
                        </div>
                        {link && (
                          <div className="mt-2.5 border-t border-[var(--border-faint)] pt-2.5">
                            <div className="flex flex-wrap items-center gap-2">
                              {link.expired ? (
                                <span className="rounded-[7px] border border-hairline bg-surface-2 px-2 py-0.5 font-mono text-[11px] text-fg-5 line-through">
                                  {host}/dr/{link.token}
                                </span>
                              ) : (
                                <>
                                  <a
                                    href={`/dr/${link.token}`}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="rounded-[7px] border border-[var(--accent-line)] bg-[var(--accent-soft)] px-2 py-0.5 font-mono text-[11px] text-[var(--accent)] hover:underline"
                                  >
                                    {host}/dr/{link.token}
                                  </a>
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    icon={copied === doc.key ? CheckCircle2 : Copy}
                                    onClick={() => copyLink(doc.key, link.token)}
                                  >
                                    {copied === doc.key ? 'Copied' : 'Copy'}
                                  </Button>
                                </>
                              )}
                              <span className="inline-flex items-center gap-1 text-[10.5px] text-fg-4">
                                <CheckCircle2 size={12} className="text-gold-1" aria-hidden />
                                Vets: {link.vetting}
                              </span>
                              <span className="flex-1" />
                              {!link.expired && (
                                <>
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    icon={ExternalLink}
                                    onClick={() => setGate(doc.key)}
                                  >
                                    Preview as recipient
                                  </Button>
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    icon={linkPending === doc.key ? Loader2 : LinkIcon}
                                    disabled={linkPending === doc.key}
                                    className="text-danger"
                                    onClick={() => revokeLink(doc.key)}
                                  >
                                    Revoke
                                  </Button>
                                </>
                              )}
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
                                    {v.email && (
                                      <span className="font-normal text-fg-5"> · {v.email}</span>
                                    )}
                                  </div>
                                  <span className="inline-flex flex-none items-center gap-1 text-[10px] font-semibold text-success">
                                    <CheckCircle2 size={11} aria-hidden />
                                    Attested
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
                  appears here the moment they pass the gate — accredited + NDA attested, every view
                  logged.
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
                        <div className="truncate text-[10.5px] text-fg-5">
                          {v.email ?? 'Access logged'}
                          {v.verifiedAt ? ` · ${relTime(v.verifiedAt)}` : ''}
                        </div>
                      </div>
                      <span className="inline-flex flex-none items-center gap-1 text-[10px] font-semibold text-success">
                        <CheckCircle2 size={11} aria-hidden />
                        Attested
                      </span>
                    </div>
                  ))}
                </div>
              )}
              <p className="mt-3 flex items-center gap-1.5 text-[10.5px] text-fg-5">
                <Info size={12} aria-hidden />
                Recipients verify on your live link — every view is logged here.
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
