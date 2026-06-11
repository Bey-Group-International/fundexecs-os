'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Archive,
  CheckCircle2,
  Clipboard,
  Download,
  FileText,
  FolderTree,
  PencilLine,
  Plus,
  Presentation,
  RefreshCcw,
  Save,
  ScrollText,
  Sparkles,
  Target,
  Users,
  type LucideIcon
} from 'lucide-react';
import { Badge, Button, Card, Input, SectionTitle, Select, SegTabs } from '@/components/ui';
import { EmptyState } from '@/components/shell/EmptyState';
import {
  createMaterialDraft,
  regenerateMaterial,
  saveMaterialVersion,
  setMaterialStatus,
  type MaterialActionResult
} from '@/lib/actions/materials';
import type { MaterialsStudioData, CapitalMaterial } from '@/lib/queries/materials';
import {
  MATERIAL_AUDIENCE_LABEL,
  MATERIAL_AUDIENCES,
  MATERIAL_KIND_LABEL,
  MATERIAL_KIND_NOTE,
  MATERIAL_KINDS,
  MATERIAL_STATUS_LABEL,
  type MaterialAudience,
  type MaterialKind,
  type MaterialStatus
} from '@/lib/materials/template';
import { cn } from '@/lib/utils';

const KIND_ICON: Record<MaterialKind, LucideIcon> = {
  pitch_deck: Presentation,
  lp_one_pager: FileText,
  ic_memo: ScrollText,
  data_room_index: FolderTree
};

const STATUS_TONE: Record<MaterialStatus, 'neutral' | 'azure' | 'success'> = {
  draft: 'azure',
  ready: 'success',
  archived: 'neutral'
};

function money(amount: number | null, currency: string): string {
  if (!amount || amount <= 0) return 'TBD';
  if (amount >= 1_000_000) return `$${(amount / 1_000_000).toFixed(1)}M`;
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    maximumFractionDigits: 0
  }).format(amount);
}

function dateLabel(value: string | null): string {
  if (!value) return 'Never';
  return new Date(value).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric'
  });
}

function sourceLabel(source: string): string {
  if (source === 'manual_edit') return 'Manual edit';
  if (source === 'ai_generator') return 'AI generator';
  return 'Template';
}

function downloadText(filename: string, body: string) {
  const blob = new Blob([body], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function filenameFor(material: CapitalMaterial): string {
  const safe = material.title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
  return `${safe || 'capital-material'}-v${material.latestVersion?.versionNumber ?? 1}.txt`;
}

function MaterialCard({
  material,
  active,
  onSelect
}: {
  material: CapitalMaterial;
  active: boolean;
  onSelect: () => void;
}) {
  const Icon = KIND_ICON[material.kind];
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        'w-full rounded-lg border p-3 text-left transition',
        active
          ? 'border-[var(--azure-line)] bg-[var(--azure-soft)]'
          : 'border-hairline bg-bg-1 hover:border-[var(--accent-line)] hover:bg-surface-1'
      )}
      data-testid={`material-card-${material.id}`}
    >
      <div className="flex items-start gap-3">
        <span className="flex h-9 w-9 flex-none items-center justify-center rounded-lg border border-hairline bg-surface-2 text-fg-3">
          <Icon size={16} strokeWidth={1.9} aria-hidden />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] font-semibold text-fg-1">
            {material.title}
          </span>
          <span className="mt-1 flex flex-wrap items-center gap-1.5">
            <Badge tone={STATUS_TONE[material.status]} className="text-[10px]">
              {MATERIAL_STATUS_LABEL[material.status]}
            </Badge>
            <span className="text-[11px] text-fg-5">
              v{material.latestVersion?.versionNumber ?? 0} - {dateLabel(material.updatedAt)}
            </span>
          </span>
        </span>
      </div>
    </button>
  );
}

function SourceSnapshot({ data }: { data: MaterialsStudioData }) {
  const source = data.source;
  const rows = [
    {
      label: 'Target',
      value: money(source.targetRaise, source.currency),
      icon: Target
    },
    {
      label: 'Committed',
      value: money(source.committedTotal, source.currency),
      icon: CheckCircle2
    },
    {
      label: 'Soft-circled',
      value: money(source.softCircleTotal, source.currency),
      icon: Users
    }
  ];

  return (
    <Card className="p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <SectionTitle eyebrow="Source snapshot" title={source.fundName} className="mb-0" />
        <Badge tone={source.openProfileGaps.length ? 'warning' : 'success'} dot>
          {source.openProfileGaps.length
            ? `${source.openProfileGaps.length} gaps`
            : 'Profile covered'}
        </Badge>
      </div>
      <div className="mt-4 grid gap-2.5 sm:grid-cols-3">
        {rows.map(({ label, value, icon: Icon }) => (
          <div key={label} className="rounded-lg border border-hairline bg-surface-1 p-3">
            <div className="flex items-center justify-between text-[10.5px] font-semibold uppercase tracking-[0.11em] text-fg-4">
              <span>{label}</span>
              <Icon size={13} strokeWidth={1.9} aria-hidden />
            </div>
            <div className="mt-1.5 text-[17px] font-semibold tabular-nums text-fg-1">{value}</div>
          </div>
        ))}
      </div>
      <p className="mt-3 text-[12.5px] leading-relaxed text-fg-4">
        {source.strategy ?? source.thesis ?? 'Complete the Source of Truth to sharpen drafts.'}
      </p>
    </Card>
  );
}

function MaterialEditor({
  selected,
  pending,
  onSave,
  onRegenerate,
  onStatus,
  onNotice
}: {
  selected: CapitalMaterial;
  pending: string | null;
  onSave: (title: string, body: string) => void;
  onRegenerate: () => void;
  onStatus: (next: MaterialStatus) => void;
  onNotice: (notice: { tone: 'success' | 'danger'; body: string }) => void;
}) {
  const [editorTitle, setEditorTitle] = useState(
    selected.latestVersion?.title ?? selected.title ?? ''
  );
  const [editorBody, setEditorBody] = useState(selected.latestVersion?.body ?? '');

  async function copy() {
    if (!editorBody) return;
    await navigator.clipboard.writeText(editorBody);
    onNotice({ tone: 'success', body: 'Copied latest text.' });
  }

  function download() {
    if (!editorBody) return;
    downloadText(filenameFor(selected), editorBody);
    onNotice({ tone: 'success', body: 'Downloaded text export.' });
  }

  return (
    <Card className="p-4">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-hairline pb-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={STATUS_TONE[selected.status]} dot>
              {MATERIAL_STATUS_LABEL[selected.status]}
            </Badge>
            <Badge tone="neutral">{MATERIAL_KIND_LABEL[selected.kind]}</Badge>
            <span className="text-[11.5px] text-fg-5">
              {selected.latestVersion
                ? `v${selected.latestVersion.versionNumber} - ${sourceLabel(selected.latestVersion.source)}`
                : 'No versions yet'}
            </span>
          </div>
          <h2 className="mt-2 truncate text-[18px] font-semibold text-fg-1">{selected.title}</h2>
        </div>
        <SegTabs
          active={selected.status}
          onChange={(id) => onStatus(id as MaterialStatus)}
          tabs={[
            { id: 'draft', label: 'Draft' },
            { id: 'ready', label: 'Ready' },
            { id: 'archived', label: 'Archive' }
          ]}
        />
      </div>

      <div className="mt-4 grid gap-3">
        <Input
          label="Title"
          value={editorTitle}
          onChange={(event) => setEditorTitle(event.target.value)}
          data-testid="materials-title"
        />
        <label className="flex flex-col gap-1.5">
          <span className="text-[12.5px] font-medium text-fg-3">Body</span>
          <textarea
            value={editorBody}
            onChange={(event) => setEditorBody(event.target.value)}
            rows={22}
            className="min-h-[420px] w-full resize-y rounded-xl border border-hairline bg-surface-2 px-3 py-3 font-mono text-[12.5px] leading-relaxed text-fg-1 outline-none transition focus:border-[var(--accent-line)] focus:shadow-[0_0_0_3px_var(--accent-soft)]"
            data-testid="materials-body"
          />
        </label>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <Button
          variant="primary"
          icon={Save}
          onClick={() => onSave(editorTitle, editorBody)}
          disabled={pending !== null || !editorBody.trim()}
          data-testid="materials-save-version"
        >
          {pending === 'save' ? 'Saving...' : 'Save version'}
        </Button>
        <Button
          variant="secondary"
          icon={RefreshCcw}
          onClick={onRegenerate}
          disabled={pending !== null}
        >
          {pending === 'regenerate' ? 'Generating...' : 'Regenerate'}
        </Button>
        <Button
          variant="secondary"
          icon={Clipboard}
          onClick={() => void copy()}
          disabled={!editorBody.trim()}
        >
          Copy
        </Button>
        <Button
          variant="secondary"
          icon={Download}
          onClick={download}
          disabled={!editorBody.trim()}
        >
          Download text
        </Button>
        {selected.status !== 'ready' ? (
          <Button
            variant="gold"
            icon={CheckCircle2}
            onClick={() => onStatus('ready')}
            disabled={pending !== null || !selected.latestVersion}
          >
            {pending === 'status-ready' ? 'Marking...' : 'Mark ready'}
          </Button>
        ) : (
          <Button
            variant="outline"
            icon={Archive}
            onClick={() => onStatus('archived')}
            disabled={pending !== null}
          >
            Archive
          </Button>
        )}
      </div>
    </Card>
  );
}

export function MaterialsStudio({ data }: { data: MaterialsStudioData }) {
  const router = useRouter();
  const [kind, setKind] = useState<MaterialKind>('pitch_deck');
  const [audience, setAudience] = useState<MaterialAudience>('institutional_lp');
  const [title, setTitle] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(data.materials[0]?.id ?? null);
  const [pending, setPending] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ tone: 'success' | 'danger'; body: string } | null>(null);
  const selected =
    data.materials.find((material) => material.id === selectedId) ?? data.materials[0] ?? null;

  async function run(
    key: string,
    action: () => Promise<MaterialActionResult>,
    success: (result: Extract<MaterialActionResult, { ok: true }>) => string
  ) {
    setPending(key);
    setNotice(null);
    try {
      const result = await action();
      if (!result.ok) {
        setNotice({ tone: 'danger', body: result.error });
        return;
      }
      setSelectedId(result.materialId);
      setNotice({ tone: 'success', body: success(result) });
      router.refresh();
    } catch (error) {
      setNotice({
        tone: 'danger',
        body: error instanceof Error ? error.message : 'Action failed.'
      });
    } finally {
      setPending(null);
    }
  }

  const create = () =>
    run(
      'create',
      () => createMaterialDraft({ kind, audience, title }),
      () => 'Draft generated and saved.'
    );

  const regenerate = (material: CapitalMaterial) => {
    void run(
      'regenerate',
      () => regenerateMaterial(material.id),
      () => 'New version generated.'
    );
  };

  const save = (material: CapitalMaterial, editorTitle: string, editorBody: string) => {
    void run(
      'save',
      () =>
        saveMaterialVersion({
          materialId: material.id,
          title: editorTitle,
          body: editorBody
        }),
      () => 'Manual version saved.'
    );
  };

  const status = (material: CapitalMaterial, next: MaterialStatus) => {
    void run(
      `status-${next}`,
      () => setMaterialStatus(material.id, next),
      (result) => {
        if (next === 'ready') {
          window.emitTrust?.({
            layer: 'concept',
            title: 'Material ready',
            msg: 'A capital material is ready for LP review.',
            pct: 100,
            entity: material.title
          });
          return result.xp ? 'Marked ready. Concept XP recorded.' : 'Marked ready.';
        }
        return `Marked ${MATERIAL_STATUS_LABEL[next].toLowerCase()}.`;
      }
    );
  };

  return (
    <div className="mx-auto max-w-6xl space-y-6 px-4 py-8 sm:px-6" data-testid="materials-studio">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <span
            className="flex h-[42px] w-[42px] flex-none items-center justify-center rounded-[12px] border border-[var(--accent-line)] bg-[var(--accent-soft)] text-[var(--accent)]"
            aria-hidden
          >
            <FolderTree size={21} strokeWidth={1.9} />
          </span>
          <SectionTitle eyebrow="Capital Materials" title="Materials Studio" className="mb-0" />
        </div>
        <div className="grid grid-cols-4 gap-2 text-center">
          {[
            ['Total', data.stats.total],
            ['Ready', data.stats.ready],
            ['Draft', data.stats.draft],
            ['Versions', data.stats.versionCount]
          ].map(([label, value]) => (
            <div key={label} className="rounded-lg border border-hairline bg-bg-1 px-3 py-2">
              <div className="text-[16px] font-semibold tabular-nums text-fg-1">{value}</div>
              <div className="text-[10px] uppercase tracking-[0.1em] text-fg-4">{label}</div>
            </div>
          ))}
        </div>
      </div>

      <SourceSnapshot data={data} />

      <Card className="p-4">
        <div className="grid gap-3 lg:grid-cols-[1fr_1fr_auto] lg:items-end">
          <Select
            label="Format"
            value={kind}
            onChange={(event) => setKind(event.target.value as MaterialKind)}
            options={MATERIAL_KINDS.map((value) => ({
              value,
              label: MATERIAL_KIND_LABEL[value]
            }))}
          />
          <Select
            label="Audience"
            value={audience}
            onChange={(event) => setAudience(event.target.value as MaterialAudience)}
            options={MATERIAL_AUDIENCES.map((value) => ({
              value,
              label: MATERIAL_AUDIENCE_LABEL[value]
            }))}
          />
          <Button
            variant="primary"
            icon={Sparkles}
            onClick={create}
            disabled={pending !== null}
            data-testid="materials-generate"
            className="lg:self-end"
          >
            {pending === 'create' ? 'Generating...' : 'Generate draft'}
          </Button>
        </div>
        <div className="mt-3 grid gap-3 lg:grid-cols-[1fr_2fr]">
          <p className="text-[12px] leading-relaxed text-fg-4">{MATERIAL_KIND_NOTE[kind]}</p>
          <Input
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder={`${data.source.fundName} ${MATERIAL_KIND_LABEL[kind]}`}
            aria-label="Optional material title"
          />
        </div>
      </Card>

      {notice ? (
        <div
          className={cn(
            'rounded-lg border px-3.5 py-2.5 text-[12.5px]',
            notice.tone === 'success'
              ? 'border-[var(--success-line)] bg-[var(--success-soft)] text-success'
              : 'border-[var(--danger-line)] bg-[var(--danger-soft)] text-danger'
          )}
          role="status"
        >
          {notice.body}
        </div>
      ) : null}

      <div className="grid gap-5 lg:grid-cols-[340px_1fr]">
        <section aria-label="Material library">
          <div className="mb-3 flex items-center justify-between gap-3">
            <SectionTitle eyebrow="Library" title="Saved materials" className="mb-0" />
            <Badge tone="neutral">{data.stats.archived} archived</Badge>
          </div>
          {data.materials.length === 0 ? (
            <EmptyState
              icon={Plus}
              title="Generate the first draft"
              body="Choose a format and audience above. The draft will be saved here with a version trail."
              variant="card"
            />
          ) : (
            <div className="flex flex-col gap-2.5">
              {data.materials.map((material) => (
                <MaterialCard
                  key={material.id}
                  material={material}
                  active={material.id === selected?.id}
                  onSelect={() => setSelectedId(material.id)}
                />
              ))}
            </div>
          )}
        </section>

        <section aria-label="Material editor">
          {selected ? (
            <MaterialEditor
              key={`${selected.id}-${selected.latestVersion?.id ?? 'none'}`}
              selected={selected}
              pending={pending}
              onSave={(editorTitle, editorBody) => save(selected, editorTitle, editorBody)}
              onRegenerate={() => regenerate(selected)}
              onStatus={(next) => status(selected, next)}
              onNotice={setNotice}
            />
          ) : (
            <EmptyState
              icon={PencilLine}
              title="No material selected"
              body="Generate a draft or select a saved material to edit, export, or mark ready."
              variant="page"
            />
          )}
        </section>
      </div>
    </div>
  );
}

export default MaterialsStudio;
