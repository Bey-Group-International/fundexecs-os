// Audit trail export. A link rather than a fetch: the browser streams the CSV
// straight to disk and the route sets the filename, so a large log never passes
// through React state.
export function AuditExport({ roomId, roomName }: { roomId: string; roomName: string }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line bg-surface-1 px-4 py-3">
      <div className="min-w-0">
        <p className="text-sm font-medium text-fg-primary">Audit trail</p>
        <p className="mt-0.5 text-xs text-fg-muted">
          Every room and document open on {roomName}&apos;s links — timestamps, viewers, and dwell
          time — as a CSV for your compliance file.
        </p>
      </div>
      <a
        href={`/api/data-rooms/${roomId}/audit`}
        className="shrink-0 rounded-lg border border-gold-500/40 bg-gold-500/10 px-3 py-1.5 font-mono text-[11px] uppercase tracking-wider text-gold-300 transition hover:bg-gold-500/20"
      >
        ↓ Export CSV
      </a>
    </div>
  );
}
