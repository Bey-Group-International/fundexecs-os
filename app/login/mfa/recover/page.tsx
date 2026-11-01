import { redirect } from "next/navigation";
import { getSessionContext } from "@/lib/auth";
import { Logo } from "@/components/Logo";
import { useRecoveryCode } from "@/app/security/mfa/recovery-actions";

export const dynamic = "force-dynamic";

export default async function RecoverPage(props: { searchParams: Promise<{ error?: string }> }) {
  const sp = await props.searchParams;
  const ctx = await getSessionContext();
  if (!ctx) redirect("/login");
  return (
    <div className="flex min-h-screen items-center justify-center bg-surface-0 px-4 py-16">
      <div className="fx-glass w-full max-w-sm p-5 sm:p-6">
        <Logo className="mb-8 block" />
        <h1 className="text-2xl font-semibold tracking-tight text-fg-primary">Use a recovery code</h1>
        <p className="mt-1.5 text-sm text-fg-secondary">
          Enter one of the recovery codes you saved. It works once, and it removes your current
          authenticator so you can set up a new one.
        </p>
        {sp.error && (
          <p className="mt-4 rounded-md border border-red-500/20 bg-red-500/10 px-3 py-2 text-sm text-red-400">{sp.error}</p>
        )}
        <form action={useRecoveryCode} className="mt-6 space-y-4">
          <input
            name="code"
            required
            autoFocus
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            placeholder="ABCDE-FGHJK"
            aria-label="Recovery code"
            className="w-full rounded-md border border-line bg-surface-2 px-3 py-2.5 text-center font-mono text-lg tracking-widest text-fg-primary"
          />
          <button type="submit" className="w-full rounded-md bg-gold-400 py-2.5 text-sm font-semibold text-surface-0">
            Use code
          </button>
        </form>
        <a href="/login/mfa" className="mt-6 block text-center text-xs text-fg-muted hover:underline">Back to authenticator code</a>
      </div>
    </div>
  );
}
