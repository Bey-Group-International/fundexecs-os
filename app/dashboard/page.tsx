import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { signOut } from './actions';

export const metadata = {
  title: 'Command Center'
};

export default async function DashboardPage() {
  const supabase = await createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  // Defense in depth — middleware already gates this route.
  if (!user) {
    redirect('/login');
  }

  return (
    <main className="min-h-screen bg-[#070b14] text-white">
      <div className="mx-auto max-w-6xl px-6 py-16">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm text-slate-400">Command Center</p>
            <h1 className="mt-1 text-3xl font-semibold tracking-tight">Welcome back</h1>
            <p className="mt-1 text-sm text-slate-400">{user.email}</p>
          </div>
          <form action={signOut}>
            <button
              type="submit"
              className="rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm font-medium text-slate-100 transition hover:bg-white/10"
            >
              Sign out
            </button>
          </form>
        </div>

        <div className="mt-10 grid gap-4 md:grid-cols-3">
          {['Deal Pipeline', 'AI Copilot', 'Chain of Trust'].map((item) => (
            <div
              key={item}
              className="rounded-2xl border border-white/10 bg-white/[0.04] p-5 shadow-2xl shadow-black/20"
            >
              <p className="text-sm font-medium text-slate-100">{item}</p>
              <p className="mt-2 text-sm leading-6 text-slate-400">Coming soon.</p>
            </div>
          ))}
        </div>
      </div>
    </main>
  );
}
