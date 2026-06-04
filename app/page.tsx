import Link from 'next/link';

export default function HomePage() {
  return (
    <main className="min-h-screen bg-[#070b14] text-white">
      <header className="mx-auto flex max-w-6xl items-center justify-between px-6 py-6">
        <span className="text-sm font-semibold tracking-tight">FundExecs OS</span>
        <Link
          href="/login"
          className="rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm font-medium text-slate-100 transition hover:bg-white/10"
        >
          Sign in
        </Link>
      </header>
      <section className="mx-auto flex min-h-[calc(100vh-5rem)] max-w-6xl flex-col justify-center px-6 py-20">
        <div className="mb-6 inline-flex w-fit rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm text-slate-300">
          AI-native private-market command center
        </div>

        <h1 className="max-w-4xl text-5xl font-semibold tracking-tight md:text-7xl">
          FundExecs OS turns any fund into an execution machine.
        </h1>

        <p className="mt-6 max-w-2xl text-lg leading-8 text-slate-300">
          Streamline workflows, accelerate decisions, and level up operators so emerging managers
          can scale like top-tier institutions without adding headcount or friction.
        </p>

        <div className="mt-10 grid gap-4 md:grid-cols-3">
          {[
            'AI Copilot Task Manager',
            'Chain of Trust Progress System',
            'Deal, Allocation, and Partnership Pipeline'
          ].map((item) => (
            <div
              key={item}
              className="rounded-2xl border border-white/10 bg-white/[0.04] p-5 shadow-2xl shadow-black/20"
            >
              <p className="text-sm font-medium text-slate-100">{item}</p>
              <p className="mt-2 text-sm leading-6 text-slate-400">
                Built for institutional execution, private-market intelligence, and proof-based
                workflows.
              </p>
            </div>
          ))}
        </div>
      </section>
    </main>
  );
}
