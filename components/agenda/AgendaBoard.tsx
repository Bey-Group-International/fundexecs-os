// components/agenda/AgendaBoard.tsx — the deadlines board (server shell).
//
// Server component (no "use client", no hooks). Owns the read-only header bits —
// the summary headline and an overdue marker — then delegates the interactive,
// filterable, bucketed LIST to <AgendaControls>, passing only the flat,
// serializable AgendaItem[]. The empty state stays here so the board reads
// "Nothing scheduled — you're clear." when there is genuinely nothing dated.
import { type Agenda } from "@/lib/agenda";
import { AgendaControls } from "./AgendaControls";

export function AgendaBoard({ agenda }: { agenda: Agenda }) {
  if (agenda.total === 0) {
    return (
      <p className="rounded-xl border border-dashed border-line bg-surface-1 p-6 text-center text-sm text-fg-muted">
        Nothing scheduled — you&rsquo;re clear.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-[10px] uppercase tracking-wider text-fg-muted">
          {agenda.summary}
        </span>
        {agenda.overdue > 0 ? (
          <span className="rounded-full border border-status-danger/30 bg-status-danger/10 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-status-danger">
            {agenda.overdue} overdue
          </span>
        ) : null}
      </div>

      <AgendaControls items={agenda.items} />
    </div>
  );
}
