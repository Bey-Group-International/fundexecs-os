import Link from "next/link";
import { getSessionContext } from "@/lib/auth";
import { redirect } from "next/navigation";
import { signIn, signUp } from "./actions";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: { error?: string; mode?: string; message?: string };
}) {
  const ctx = await getSessionContext();
  if (ctx) redirect(ctx.orgId ? "/workspace" : "/onboarding");

  const isSignup = searchParams.mode === "signup";

  return (
    <div className="flex min-h-screen bg-surface-0">
      {/* Left branding panel */}
      <div className="hidden w-2/5 flex-col justify-between border-r border-line p-12 lg:flex">
        <Link href="/" className="font-mono text-xs uppercase tracking-[0.2em] text-gold-400">
          FundExecs OS
        </Link>
        <div>
          <p className="text-2xl font-semibold leading-snug tracking-tight text-fg-primary">
            The Operating System<br />for Private Markets
          </p>
          <p className="mt-3 text-sm text-fg-secondary">
            PE funds, real estate investors, and family offices — unified in one
            AI-native platform.
          </p>
        </div>
        <p className="font-mono text-xs text-fg-muted">Pre-Alpha · Invite only</p>
      </div>

      {/* Right form panel */}
      <div className="flex flex-1 flex-col items-center justify-center px-6">
        <div className="w-full max-w-sm">
          <Link href="/" className="mb-8 block font-mono text-xs uppercase tracking-[0.2em] text-gold-400 lg:hidden">
            FundExecs OS
          </Link>

          <h1 className="text-2xl font-semibold tracking-tight text-fg-primary">
            {isSignup ? "Create your account" : "Welcome back"}
          </h1>
          <p className="mt-1.5 text-sm text-fg-secondary">
            {isSignup
              ? "Start your private-markets OS."
              : "Sign in to your workspace."}
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

          <form className="mt-6 flex flex-col gap-3">
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
