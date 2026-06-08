import type { Metadata } from 'next';
import { createClient } from '@/lib/supabase/server';
import { EarnCoin } from '@/components/screens/EarnCoin';
import { SetPasswordForm } from '@/components/account/SetPasswordForm';
import { RequestPasswordResetForm } from '@/components/account/RequestPasswordResetForm';

export const metadata: Metadata = { title: 'Reset your password' };

/**
 * Password-reset landing. The emailed recovery link rides through /auth/callback
 * (which exchanges the code into a session) and on to here:
 *   - With a recovery session → set a new password, then into the app.
 *   - Without one (link expired / opened on another device) → request a fresh
 *     link. /auth/* is public in middleware, so this is reachable either way.
 */
export default async function ResetPasswordPage() {
  const supabase = await createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  return (
    <main className="flex min-h-screen items-center justify-center bg-bg-0 px-4 py-10 text-fg-1">
      <div className="w-full max-w-md">
        <div className="mb-5 flex items-center gap-2.5">
          <EarnCoin size={28} />
          <span className="text-[15px] font-semibold tracking-[-0.02em]">
            FundExecs <span className="font-medium text-fg-4">OS</span>
          </span>
        </div>

        <div className="rounded-2xl border border-hairline bg-surface-1 p-6 shadow-[var(--shadow-lg)]">
          {user ? (
            <>
              <h1 className="text-[17px] font-semibold tracking-tight">Set a new password</h1>
              <p className="mt-1 mb-5 text-[12.5px] text-fg-4">
                Choose a new password for{' '}
                <span className="font-medium text-fg-2">{user.email}</span>. You&apos;ll use it with
                your email to sign in from now on.
              </p>
              <SetPasswordForm
                submitLabel="Save new password"
                redirectTo="/command-center"
                autoFocus
              />
            </>
          ) : (
            <>
              <h1 className="text-[17px] font-semibold tracking-tight">Reset your password</h1>
              <p className="mt-1 mb-5 text-[12.5px] text-fg-4">
                Enter your email and we&apos;ll send a link to set a new password. Open it on this
                device to finish.
              </p>
              <RequestPasswordResetForm />
            </>
          )}
        </div>

        <p className="mt-5 text-center text-[11px] text-fg-5">
          Secured by Supabase Auth · open the reset link on the same device you requested it.
        </p>
      </div>
    </main>
  );
}
