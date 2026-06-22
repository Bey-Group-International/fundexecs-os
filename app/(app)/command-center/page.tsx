import { CommandCenter } from "@/components/CommandCenter";

export const dynamic = "force-dynamic";

export default function CommandCenterPage() {
  return (
    <div className="mx-auto max-w-5xl px-4 py-8">
      <header className="mb-6">
        <p className="font-mono text-[11px] uppercase tracking-[0.25em] text-fg-muted">
          Mission Control
        </p>
        <h1 className="mt-1 text-2xl font-semibold text-fg-primary">Command Center</h1>
      </header>
      <CommandCenter />
    </div>
  );
}
