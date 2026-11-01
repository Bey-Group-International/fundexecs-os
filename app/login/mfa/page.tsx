import { redirect } from "next/navigation";
import { getSessionContext } from "@/lib/auth";
import { Logo } from "@/components/Logo";
import { signOut } from "@/app/login/actions";
import { MFA_ENROLL_PATH, mfaGate } from "@/lib/mfa";
import { verifyLoginChallenge } from "@/app/security/mfa/actions";

export const dynamic = "force-dynamic";

export default async function MfaChallengePage(props: {
  searchParams: Promise<{ error?: string; next?: string }>;
}) {
  const sp = await props.searchParams;
  const ctx = await getSessionContext();
  if (!ctx) redirect("/login");
  const gate = ctx.mfa ? mfaGate(ctx.mfa) : "ok";
  if (gate === "enroll") redirect(MFA_ENROLL_PATH);
  if (gate === "ok") redirect(typeof sp.next === "string" && sp.next.startsWith("/") ? sp.next : "/workspace");

  return (
    <div className="flex min-h-screen items-center justify-center bg-surface-0 px-4 py-16">
      <div className="fx-glass w-full max-w-sm p-5 sm:p-6">
        <Logo className="mb-8 block" />
        <h1 className="text-2xl font-semibold tracking-tight text-fg-primary">Enter your code</h1>
        <p className="mt-1.5 text-sm text-fg-secondary">
          Open your authenticator app and enter the 6-digit code for FundExecs OS.
        </p>
        {sp.error && (
          <p className="mt-4 rounded-md border border-red-500/20 bg-red-500/10 px-3 py-2 text-sm text-red-400">
            {sp.error}
          </p>
        )}
        <form action={verifyLoginChallenge} className="mt-6 space-y-4">
          {sp.next && <input type="hidden" name="next" value={sp.next} />}
          <input
            name="code"
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="[0-9 ]*"
            maxLength={7}
            required
            autoFocus
            placeholder="123456"
            aria-label="6-digit code"
            className="w-full rounded-md border border-line bg-surface-2 px-3 py-2.5 text-center font-mono text-lg tracking-widest text-fg-primary"
          />
          <button type="submit" className="w-full rounded-md bg-gold-400 py-2.5 text-sm font-semibold text-surface-0">
            Verify
          </button>
        </form>
        <a href="/login/mfa/recover" className="mt-4 block text-center text-xs text-gold-300 hover:underline">
          Lost your device? Use a recovery code
        </a>
        <form action={signOut} className="mt-4 text-center">
          <button type="submit" className="text-xs text-fg-muted hover:underline">Sign out</button>
        </form>
      </div>
    </div>
  );
}
