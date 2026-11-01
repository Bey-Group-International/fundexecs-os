import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { getSessionContext } from "@/lib/auth";
import { Logo } from "@/components/Logo";
import { signOut } from "@/app/login/actions";
import { createServerClient } from "@/lib/supabase/server";
import { getAppUrlFromHeaders } from "@/lib/integrations/adapters/app-url";
import { DEFAULT_POST_AUTH_PATH, safeNextPathOrNull } from "@/lib/safe-next-path";
import { MFA_CHALLENGE_PATH, mfaGate, verifiedTotpFactors } from "@/lib/mfa";
import { EnrollTotp } from "./EnrollTotp";
import { RecoveryCodes } from "./RecoveryCodes";
import { removeFactor } from "./actions";

export const dynamic = "force-dynamic";

// Lives outside the (app) layout on purpose: that layout redirects here when an
// owner/admin has no second factor, so rendering inside it would loop.
export default async function MfaSettingsPage(props: {
  searchParams: Promise<{ error?: string; next?: string }>;
}) {
  const sp = await props.searchParams;
  const ctx = await getSessionContext();
  if (!ctx) redirect("/login");
  // Enrolled but not yet verified this session: answer the challenge first, so
  // nobody can add or remove factors from a password-only session.
  if (ctx.mfa && mfaGate(ctx.mfa) === "challenge") redirect(MFA_CHALLENGE_PATH);

  const base = getAppUrlFromHeaders(await headers());
  const next = safeNextPathOrNull(sp.next, base) ?? DEFAULT_POST_AUTH_PATH;

  const supabase = await createServerClient();
  const { data } = await supabase.auth.getUser();
  const factors = verifiedTotpFactors(data.user?.factors);

  return (
    <div className="flex min-h-screen items-center justify-center bg-surface-0 px-4 py-16">
      <div className="fx-glass w-full max-w-sm p-5 sm:p-6">
        <Logo className="mb-8 block" />
        <h1 className="text-2xl font-semibold tracking-tight text-fg-primary">Two-step verification</h1>
        {ctx.mfa?.required && factors.length === 0 && (
          <p className="mt-1.5 text-sm text-fg-secondary">
            Your role can see investor data, so a second step is required before you continue.
          </p>
        )}
        {sp.error && (
          <p className="mt-4 rounded-md border border-red-500/20 bg-red-500/10 px-3 py-2 text-sm text-red-400">
            {sp.error}
          </p>
        )}

        <div className="mt-6">
          {factors.length === 0 ? (
            <EnrollTotp next={next} />
          ) : (
            <>
              <p className="text-sm text-fg-secondary">Authenticator app is on for this account.</p>
              <ul className="mt-4 space-y-2">
                {factors.map((f) => (
                  <li key={f.id} className="flex items-center justify-between rounded-md border border-line px-3 py-2 text-sm">
                    <span className="text-fg-primary">{(f as { friendly_name?: string }).friendly_name ?? "Authenticator app"}</span>
                    <form action={removeFactor}>
                      <input type="hidden" name="factorId" value={f.id} />
                      <button type="submit" className="text-red-400 hover:underline">Remove</button>
                    </form>
                  </li>
                ))}
              </ul>
              <div className="mt-4">
                <RecoveryCodes label="Generate new recovery codes" />
              </div>
              <a href={next} className="mt-5 block text-center text-sm text-gold-300 hover:underline">Continue</a>
            </>
          )}
        </div>

        <form action={signOut} className="mt-6 text-center">
          <button type="submit" className="text-xs text-fg-muted hover:underline">Sign out</button>
        </form>
      </div>
    </div>
  );
}
