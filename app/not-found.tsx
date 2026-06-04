import Link from 'next/link';

export default function NotFound() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-[#070b14] px-6 text-center text-white">
      <p className="text-sm font-medium text-slate-400">404</p>
      <h1 className="mt-2 text-2xl font-semibold">Page not found</h1>
      <p className="mt-2 max-w-md text-sm text-slate-400">
        The page you are looking for does not exist or has been moved.
      </p>
      <Link
        href="/"
        className="mt-6 rounded-xl border border-white/10 bg-white/5 px-5 py-2 text-sm font-medium text-slate-100 transition hover:bg-white/10"
      >
        Back home
      </Link>
    </main>
  );
}
