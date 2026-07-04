import Link from "next/link";
import { getSessionContext } from "@/lib/auth";
import { redirect } from "next/navigation";
import { Logo } from "@/components/Logo";
import { signIn, signUp, signInWithGoogle } from "./actions";

export default async function LoginPage(
  props: {
    searchParams: Promise<{ error?: string; mode?: string; message?: string }>;
  }
) {
  const searchParams = await props.searchParams;
  const ctx = await getSessionContext();
  if (ctx) redirect(ctx.orgId ? "/workspace" : "/onboarding");

  const isSignup = searchParams.mode === "signup";

  return (
    <div className="fx-blueprint flex min-h-screen bg-surface-0">
      {/* Left branding panel */}
      <div className="hidden w-2/5 flex-col justify-between border-r border-line bg-surface-1/55 p-12 backdrop-blur-xl lg:flex">
        <Logo />
        <div>
          <p className="text-2xl font-semibold leading-snug tracking-tight text-fg-primary">
            The Operating System<br />for Private Markets
          </p>
          <p className="mt-3 text-sm text-fg-secondary">
            One OS for deal sourcing, LP relations, diligence, underwriting,
            capital events, and exit. Built for GPs, family offices, and
            advisory professionals.
          </p>
        </div>
        <p className="font-mono text-xs text-fg-muted">Early Access</p>
      </div>

      {/* Right form panel */}
      <div className="flex flex-1 flex-col items-center justify-center px-4 py-20 sm:px-6">
        <div className="fx-glass w-full max-w-sm p-5 sm:p-6">
          <Logo className="mb-8 block lg:hidden" />

          <h1 className="text-2xl font-semibold tracking-tight text-fg-primary">
            {isSignup ? "Create your account" : "Welcome back"}
          </h1>
          <p className="mt-1.5 text-sm text-fg-secondary">
            {isSignup
              ? "Your firm, your fund, your OS."
              : "Back to your workspace."}
          </p>

          {searchParams.error && (
            <p className="mt-4 rounded-md border border-red-500/20 bg-red-500/10 px-3 py-2 text-sm text-red-400">
              {searchParams.error}
            </p>
          )}
          {searchParams.message && (
            <p className="mt-4 rounded-md border border-gold-500/20 bg-gold-400/10 px-3 py-2 text-sm text-gold-300">
              {searchParams.message}
            </p>
          )}

          <form action={signInWithGoogle} className="mt-6">
            <button
              type="submit"
              className="flex w-full items-center justify-center gap-2.5 rounded-md border border-line bg-surface-2 py-2.5 text-sm font-medium text-fg-primary transition hover:bg-surface-1"
            >
              <svg className="h-4 w-4" viewBox="0 0 24 24" aria-hidden>
                <path
                  fill="#4285F4"
                  d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.27-4.74 3.27-8.1Z"
                />
                <path
                  fill="#34A853"
                  d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0 0 12 23Z"
                />
                <path
                  fill="#FBBC05"
                  d="M5.84 14.1a6.6 6.6 0 0 1 0-4.2V7.06H2.18a11 11 0 0 0 0 9.88l3.66-2.84Z"
                />
                <path
                  fill="#EA4335"
                  d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06L5.84 9.9C6.71 7.31 9.14 5.38 12 5.38Z"
                />
              </svg>
              Continue with Google
            </button>
          </form>

          <div className="my-5 flex items-center gap-3">
            <span className="h-px flex-1 bg-line" />
            <span className="font-mono text-[10px] uppercase tracking-widest text-fg-muted">or</span>
            <span className="h-px flex-1 bg-line" />
          </div>

          <form className="flex flex-col gap-3">
            {isSignup && (
              <div className="flex flex-col gap-1">
                <label className="text-xs text-fg-secondary">Full name</label>
                <input
                  name="full_name"
                  placeholder="Alex Chen"
                  autoComplete="name"
                  className="rounded-md border border-line bg-surface-2 px-3 py-2.5 text-sm text-fg-primary placeholder-fg-muted outline-none transition focus:border-gold-500 focus:bg-surface-2"
                />
              </div>
            )}
            <div className="flex flex-col gap-1">
              <label className="text-xs text-fg-secondary">Email</label>
              <input
                name="email"
                type="email"
                required
                placeholder="you@yourfirm.com"
                autoComplete="email"
                className="rounded-md border border-line bg-surface-2 px-3 py-2.5 text-sm text-fg-primary placeholder-fg-muted outline-none transition focus:border-gold-500 focus:bg-surface-2"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs text-fg-secondary">Password</label>
              <input
                name="password"
                type="password"
                required
                minLength={6}
                placeholder="••••••••"
                autoComplete={isSignup ? "new-password" : "current-password"}
                className="rounded-md border border-line bg-surface-2 px-3 py-2.5 text-sm text-fg-primary placeholder-fg-muted outline-none transition focus:border-gold-500 focus:bg-surface-2"
              />
            </div>
            <button
              formAction={isSignup ? signUp : signIn}
              className="mt-2 rounded-md bg-gold-400 py-2.5 text-sm font-medium text-surface-0 transition hover:opacity-90"
            >
              {isSignup ? "Create account" : "Sign in"}
            </button>
          </form>

          <p className="mt-5 text-center text-sm text-fg-muted">
            {isSignup ? (
              <>
                Already have an account?{" "}
                <Link href="/login" className="text-gold-400 hover:underline">
                  Sign in
                </Link>
              </>
            ) : (
              <>
                New here?{" "}
                <Link href="/login?mode=signup" className="text-gold-400 hover:underline">
                  Create an account
                </Link>
              </>
            )}
          </p>
        </div>
      </div>
    </div>
  );
}
