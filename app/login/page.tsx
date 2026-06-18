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
    <div className="flex min-h-screen bg-[#0a0a0a]">
      {/* Left branding panel */}
      <div className="hidden w-2/5 flex-col justify-between border-r border-white/5 p-12 lg:flex">
        <Link href="/" className="font-mono text-xs uppercase tracking-[0.2em] text-agent-associate">
          FundExecs OS
        </Link>
        <div>
          <p className="text-2xl font-semibold leading-snug tracking-tight text-white">
            The Operating System<br />for Private Markets
          </p>
          <p className="mt-3 text-sm text-neutral-500">
            PE funds, real estate investors, and family offices — unified in one
            AI-native platform.
          </p>
        </div>
        <p className="font-mono text-xs text-neutral-700">Pre-Alpha · Invite only</p>
      </div>

      {/* Right form panel */}
      <div className="flex flex-1 flex-col items-center justify-center px-6">
        <div className="w-full max-w-sm">
          <Link href="/" className="mb-8 block font-mono text-xs uppercase tracking-[0.2em] text-agent-associate lg:hidden">
            FundExecs OS
          </Link>

          <h1 className="text-2xl font-semibold tracking-tight text-white">
            {isSignup ? "Create your account" : "Welcome back"}
          </h1>
          <p className="mt-1.5 text-sm text-neutral-500">
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
            <p className="mt-4 rounded-md border border-agent-associate/20 bg-agent-associate/10 px-3 py-2 text-sm text-indigo-300">
              {searchParams.message}
            </p>
          )}

          <form className="mt-6 flex flex-col gap-3">
            {isSignup && (
              <div className="flex flex-col gap-1">
                <label className="text-xs text-neutral-500">Full name</label>
                <input
                  name="full_name"
                  placeholder="Alex Chen"
                  autoComplete="name"
                  className="rounded-md border border-white/10 bg-white/5 px-3 py-2.5 text-sm text-white placeholder-neutral-600 outline-none transition focus:border-agent-associate focus:bg-white/[0.07]"
                />
              </div>
            )}
            <div className="flex flex-col gap-1">
              <label className="text-xs text-neutral-500">Email</label>
              <input
                name="email"
                type="email"
                required
                placeholder="you@yourfirm.com"
                autoComplete="email"
                className="rounded-md border border-white/10 bg-white/5 px-3 py-2.5 text-sm text-white placeholder-neutral-600 outline-none transition focus:border-agent-associate focus:bg-white/[0.07]"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs text-neutral-500">Password</label>
              <input
                name="password"
                type="password"
                required
                minLength={6}
                placeholder="••••••••"
                autoComplete={isSignup ? "new-password" : "current-password"}
                className="rounded-md border border-white/10 bg-white/5 px-3 py-2.5 text-sm text-white placeholder-neutral-600 outline-none transition focus:border-agent-associate focus:bg-white/[0.07]"
              />
            </div>
            <button
              formAction={isSignup ? signUp : signIn}
              className="mt-2 rounded-md bg-agent-associate py-2.5 text-sm font-medium text-white transition hover:opacity-90"
            >
              {isSignup ? "Create account" : "Sign in"}
            </button>
          </form>

          <p className="mt-5 text-center text-sm text-neutral-600">
            {isSignup ? (
              <>
                Already have an account?{" "}
                <Link href="/login" className="text-agent-associate hover:underline">
                  Sign in
                </Link>
              </>
            ) : (
              <>
                New here?{" "}
                <Link href="/login?mode=signup" className="text-agent-associate hover:underline">
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
