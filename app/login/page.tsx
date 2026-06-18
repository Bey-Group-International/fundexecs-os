import Link from "next/link";
import { getSessionContext } from "@/lib/auth";
import { redirect } from "next/navigation";
import { signIn, signUp } from "./actions";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: { error?: string; mode?: string; message?: string };
}) {
  // Already signed in? Skip straight through.
  const ctx = await getSessionContext();
  if (ctx) redirect(ctx.orgId ? "/workspace" : "/onboarding");

  const isSignup = searchParams.mode === "signup";

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6">
      <p className="font-mono text-xs uppercase tracking-[0.2em] text-gold-400">
        FundExecs OS
      </p>
      <h1 className="mt-2 text-2xl font-semibold tracking-tight">
        {isSignup ? "Create your account" : "Sign in"}
      </h1>

      {searchParams.error ? (
        <p className="mt-4 rounded-md border border-agent-diligence/40 bg-agent-diligence/10 px-3 py-2 text-sm text-red-300">
          {searchParams.error}
        </p>
      ) : null}

      {searchParams.message ? (
        <p className="mt-4 rounded-md border border-gold-500/40 bg-gold-400/10 px-3 py-2 text-sm text-indigo-200">
          {searchParams.message}
        </p>
      ) : null}

      <form className="mt-6 flex flex-col gap-3">
        {isSignup ? (
          <input
            name="full_name"
            placeholder="Full name"
            autoComplete="name"
            className="rounded-md border border-line bg-surface-1 px-3 py-2 text-sm outline-none focus:border-gold-500"
          />
        ) : null}
        <input
          name="email"
          type="email"
          required
          placeholder="Email"
          autoComplete="email"
          className="rounded-md border border-line bg-surface-1 px-3 py-2 text-sm outline-none focus:border-gold-500"
        />
        <input
          name="password"
          type="password"
          required
          minLength={6}
          placeholder="Password"
          autoComplete={isSignup ? "new-password" : "current-password"}
          className="rounded-md border border-line bg-surface-1 px-3 py-2 text-sm outline-none focus:border-gold-500"
        />
        <button
          formAction={isSignup ? signUp : signIn}
          className="mt-1 rounded-md bg-gold-400 px-3 py-2 text-sm font-medium text-surface-0 transition hover:opacity-90"
        >
          {isSignup ? "Create account" : "Sign in"}
        </button>
      </form>

      <p className="mt-6 text-sm text-fg-muted">
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
            <Link
              href="/login?mode=signup"
              className="text-gold-400 hover:underline"
            >
              Create an account
            </Link>
          </>
        )}
      </p>
    </main>
  );
}
