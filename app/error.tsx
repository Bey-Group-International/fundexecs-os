'use client';

export default function Error({
  reset
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-[#070b14] px-6 text-center text-white">
      <h1 className="text-2xl font-semibold">Something went wrong</h1>
      <p className="mt-2 max-w-md text-sm text-slate-400">
        An unexpected error occurred. You can try again, and if it keeps happening reach out to
        support.
      </p>
      <button
        onClick={reset}
        className="mt-6 rounded-xl border border-white/10 bg-white/5 px-5 py-2 text-sm font-medium text-slate-100 transition hover:bg-white/10"
      >
        Try again
      </button>
    </main>
  );
}
