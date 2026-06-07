import { Presentation, FileText, ScrollText, FolderTree, type LucideIcon } from 'lucide-react';
import { SectionTitle } from '@/components/ui';

/* ============================================================================
 * MaterialsPreview — on-brand preview strip for the Capital Materials Studio
 * coming-soon. Renders the formats the studio will generate as a tasteful card
 * row so the placeholder reads as a deliberate stub, not a flat dead-end.
 * Static, tokens-only, no data.
 * ========================================================================= */

const FORMATS: { icon: LucideIcon; title: string; note: string }[] = [
  { icon: Presentation, title: 'Pitch deck', note: 'Built from your Fund Profile' },
  { icon: FileText, title: 'LP one-pager', note: 'Audience-tuned by Earn' },
  { icon: ScrollText, title: 'IC memo', note: 'Source-of-Truth fields' },
  { icon: FolderTree, title: 'Data-room index', note: 'Versioned & traceable' }
];

export function MaterialsPreview() {
  return (
    <div>
      <SectionTitle eyebrow="On the roadmap" title="Formats the studio will generate" />
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
        {FORMATS.map((f) => {
          const Icon = f.icon;
          return (
            <div
              key={f.title}
              className="flex flex-col gap-2 rounded-xl border border-hairline bg-bg-1 p-3.5"
            >
              <span className="flex h-9 w-9 items-center justify-center rounded-xl border border-[var(--azure-line)] bg-[var(--azure-soft)] text-azure-1">
                <Icon size={16} strokeWidth={2} aria-hidden />
              </span>
              <p className="text-[12.5px] font-semibold text-fg-1">{f.title}</p>
              <p className="text-[10.5px] leading-relaxed text-fg-4">{f.note}</p>
            </div>
          );
        })}
      </div>
    </div>
  );
}
