// app/page.tsx
// FundExecs OS — Landing page (Server Component)
// Matches prototype design DNA: #070b14 base, Geist, gold accents, aurora BG
// Sprint Day 2 · 2026-06-12

import Link from 'next/link';
import { ArrowRight, Lock, Sparkles, Shield, Zap, BarChart3, Users } from 'lucide-react';
import { EarnCoin, Wordmark } from '@/components/brand/BrandPrimitives';

/* ── Specialist chip ── */
function Chip({ name, role, tone = 'azure' }: { name: string; role: string; tone?: string }) {
  const colors: Record<string, { bg: string; border: string; text: string }> = {
    gold: { bg: 'rgba(247,201,72,0.1)', border: 'rgba(247,201,72,0.25)', text: '#F7C948' },
    azure: { bg: 'rgba(96,165,250,0.08)', border: 'rgba(96,165,250,0.2)', text: '#60a5fa' },
    success: { bg: 'rgba(52,211,153,0.08)', border: 'rgba(52,211,153,0.2)', text: '#34d399' }
  };
  const c = colors[tone] || colors.azure;
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '7px 12px',
        borderRadius: 999,
        border: `1px solid ${c.border}`,
        background: c.bg,
        fontSize: 12.5
      }}
    >
      <span
        style={{
          width: 20,
          height: 20,
          borderRadius: '50%',
          background: c.bg,
          border: `1px solid ${c.border}`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: c.text,
          fontSize: 9,
          fontWeight: 700
        }}
      >
        {name[0]}
      </span>
      <div>
        <span style={{ fontWeight: 600, color: 'var(--fg-1)' }}>{name}</span>
        <span style={{ color: 'var(--fg-4)', marginLeft: 5, fontSize: 11 }}>{role}</span>
      </div>
    </div>
  );
}

const SPECIALISTS = [
  { name: 'Earn', role: 'COO', tone: 'gold' },
  { name: 'Sterling', role: 'Chief of Staff', tone: 'azure' },
  { name: 'Marcus', role: 'Deal Origination', tone: 'azure' },
  { name: 'Sloane', role: 'Capital Formation', tone: 'azure' },
  { name: 'Adrian', role: 'General Counsel', tone: 'success' },
  { name: 'Eleanor', role: 'Investor Relations', tone: 'azure' },
  { name: 'Priya', role: 'Capital Markets', tone: 'azure' },
  { name: 'Theodore', role: 'Strategy', tone: 'azure' },
  { name: 'Dalia', role: 'Data Ops', tone: 'azure' },
  { name: 'Vivian', role: 'Demand Gen', tone: 'azure' },
  { name: 'Sienna', role: 'Communications', tone: 'azure' },
  { name: 'Camille', role: 'Top of Funnel', tone: 'azure' },
  { name: 'Noah', role: 'Digital Presence', tone: 'azure' },
  { name: 'Jasper', role: 'Private Events', tone: 'azure' },
  { name: 'Felix', role: 'Enablement', tone: 'azure' }
];

const FEATURES = [
  {
    icon: <Sparkles size={18} />,
    title: 'AI Executive Team',
    desc: '15 specialists handle sourcing, diligence, capital formation, and closes — you set direction and approve.'
  },
  {
    icon: <BarChart3 size={18} />,
    title: 'Command Center',
    desc: 'One ranked next move, every session. Your team worked overnight; Earn surfaces what matters most.'
  },
  {
    icon: <Shield size={18} />,
    title: 'Chain of Trust',
    desc: 'Four-layer trust architecture — nothing executes without your approval. Full audit trail on every action.'
  },
  {
    icon: <Zap size={18} />,
    title: 'Lifecycle Coverage',
    desc: 'Source → Diligence → Execute → Build. Every hub, fully automated, from first fund to $500M raise.'
  },
  {
    icon: <Users size={18} />,
    title: 'GP/LP Collaboration',
    desc: 'Structured data rooms, automated LP updates, and co-investor coordination — all in one place.'
  },
  {
    icon: <Lock size={18} />,
    title: 'Operator-Grade Security',
    desc: 'SOC 2, Row-Level Security, Supabase Auth. Built for institutional-grade data sensitivity.'
  }
];

const STATS: [string, string][] = [
  ['$500M+', 'raises supported'],
  ['15', 'AI specialists'],
  ['4-layer', 'Chain of Trust'],
  ['7 hubs', 'full lifecycle']
];

export default function LandingPage() {
  return (
    <div
      style={{
        minHeight: '100vh',
        background: '#070b14',
        color: '#f1f5f9',
        fontFamily: 'Geist, -apple-system, BlinkMacSystemFont, sans-serif',
        position: 'relative',
        overflow: 'hidden'
      }}
    >
      {/* Aurora background */}
      <div className="bg-aurora" />
      <div
        style={{
          position: 'absolute',
          inset: 0,
          pointerEvents: 'none',
          background: 'radial-gradient(46% 38% at 50% 20%, rgba(247,201,72,0.06), transparent 70%)'
        }}
      />

      {/* Nav */}
      <header
        style={{
          position: 'relative',
          zIndex: 10,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '20px clamp(20px,5vw,52px)',
          borderBottom: '1px solid rgba(255,255,255,0.06)'
        }}
      >
        <Wordmark />
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <Link
            href="/airdrop"
            style={{
              fontSize: 13,
              color: 'var(--fg-3)',
              padding: '8px 14px',
              borderRadius: 10,
              border: '1px solid var(--border)',
              background: 'var(--surface-1)',
              textDecoration: 'none',
              whiteSpace: 'nowrap'
            }}
          >
            Check airdrop
          </Link>
          <Link
            href="/login"
            style={{
              fontSize: 13,
              color: 'var(--fg-1)',
              padding: '8px 14px',
              borderRadius: 10,
              border: '1px solid transparent',
              background: 'rgba(255,255,255,0.08)',
              textDecoration: 'none'
            }}
          >
            Sign in
          </Link>
        </div>
      </header>

      {/* Hero */}
      <main style={{ position: 'relative', zIndex: 1 }}>
        <section
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            textAlign: 'center',
            padding: 'clamp(56px,8vh,96px) clamp(20px,5vw,52px) 64px',
            maxWidth: 960,
            margin: '0 auto'
          }}
        >
          {/* Beta badge */}
          <div
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 7,
              padding: '5px 13px',
              borderRadius: 999,
              border: '1px solid rgba(96,165,250,0.3)',
              background: 'rgba(96,165,250,0.07)',
              fontSize: 12,
              fontWeight: 600,
              color: '#60a5fa',
              marginBottom: 28
            }}
          >
            <span
              style={{
                width: 6,
                height: 6,
                borderRadius: 999,
                background: '#60a5fa',
                animation: 'pulse 2s infinite'
              }}
            />
            Invite-only private beta — join the waitlist
          </div>

          <h1
            style={{
              fontSize: 'clamp(36px,6vw,64px)',
              lineHeight: 1.04,
              fontWeight: 600,
              letterSpacing: '-0.03em',
              margin: '0 0 24px'
            }}
          >
            Set the mandate.
            <br />
            Your AI executive team <span style={{ color: '#F7C948' }}>does the rest.</span>
          </h1>

          <p
            style={{
              fontSize: 'clamp(15px,1.8vw,18px)',
              lineHeight: 1.65,
              color: 'var(--fg-3)',
              maxWidth: 640,
              margin: '0 0 36px'
            }}
          >
            Fifteen specialists, led by Earn, launch the fund, raise the capital, source the deals,
            and drive every engagement to a signed close. You set direction and approve — they
            execute. From a student-led first fund to a $500M raise.
          </p>

          {/* CTAs */}
          <div
            style={{
              display: 'flex',
              gap: 12,
              flexWrap: 'wrap',
              justifyContent: 'center',
              marginBottom: 20
            }}
          >
            <Link
              href="/waitlist"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 8,
                padding: '12px 22px',
                borderRadius: 14,
                fontSize: 15,
                fontWeight: 600,
                background: 'linear-gradient(135deg,#F7C948,#E5A823)',
                color: '#070b14',
                textDecoration: 'none',
                boxShadow: '0 8px 24px -8px rgba(247,201,72,0.4)'
              }}
            >
              Claim your desk <ArrowRight size={16} />
            </Link>
            <Link
              href="/airdrop"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 8,
                padding: '12px 22px',
                borderRadius: 14,
                fontSize: 15,
                fontWeight: 500,
                background: 'rgba(255,255,255,0.06)',
                color: '#f1f5f9',
                border: '1px solid rgba(255,255,255,0.1)',
                textDecoration: 'none'
              }}
            >
              Check airdrop status
            </Link>
          </div>

          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 7,
              fontSize: 12,
              color: 'var(--fg-5)'
            }}
          >
            <Lock size={13} /> By referral · no card, no setup fee
          </div>

          {/* Stats */}
          <div
            style={{
              display: 'flex',
              gap: 'clamp(24px,5vw,56px)',
              marginTop: 52,
              flexWrap: 'wrap',
              justifyContent: 'center'
            }}
          >
            {STATS.map(([v, l]) => (
              <div key={l} style={{ textAlign: 'center' }}>
                <div
                  style={{
                    fontSize: 'clamp(22px,3vw,30px)',
                    fontWeight: 700,
                    letterSpacing: '-0.02em',
                    color: '#F7C948'
                  }}
                >
                  {v}
                </div>
                <div style={{ fontSize: 12, color: 'var(--fg-4)', marginTop: 4 }}>{l}</div>
              </div>
            ))}
          </div>
        </section>

        {/* Specialist grid */}
        <section
          style={{ padding: '0 clamp(20px,5vw,52px) 72px', maxWidth: 1080, margin: '0 auto' }}
        >
          <div style={{ textAlign: 'center', marginBottom: 28 }}>
            <div
              style={{
                fontSize: 11,
                letterSpacing: '0.08em',
                textTransform: 'uppercase',
                color: 'var(--fg-5)',
                marginBottom: 8
              }}
            >
              Your executive team
            </div>
            <div style={{ fontSize: 22, fontWeight: 600, letterSpacing: '-0.02em' }}>
              15 specialists, activated the moment you brief them.
            </div>
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, justifyContent: 'center' }}>
            {SPECIALISTS.map((s) => (
              <Chip key={s.name} {...s} />
            ))}
          </div>
        </section>

        {/* Features grid */}
        <section
          style={{ padding: '0 clamp(20px,5vw,52px) 80px', maxWidth: 1080, margin: '0 auto' }}
        >
          <div style={{ textAlign: 'center', marginBottom: 40 }}>
            <div
              style={{
                fontSize: 11,
                letterSpacing: '0.08em',
                textTransform: 'uppercase',
                color: 'var(--fg-5)',
                marginBottom: 8
              }}
            >
              Built for operators
            </div>
            <div style={{ fontSize: 22, fontWeight: 600, letterSpacing: '-0.02em' }}>
              Everything you need, nothing you don&apos;t.
            </div>
          </div>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))',
              gap: 16
            }}
          >
            {FEATURES.map((f) => (
              <div
                key={f.title}
                style={{
                  padding: '20px 22px',
                  borderRadius: 16,
                  border: '1px solid rgba(255,255,255,0.08)',
                  background: 'rgba(255,255,255,0.03)',
                  backdropFilter: 'blur(4px)'
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                    marginBottom: 12,
                    color: '#60a5fa'
                  }}
                >
                  {f.icon}
                  <span style={{ fontSize: 14.5, fontWeight: 600, color: 'var(--fg-1)' }}>
                    {f.title}
                  </span>
                </div>
                <p style={{ fontSize: 13.5, lineHeight: 1.6, color: 'var(--fg-4)', margin: 0 }}>
                  {f.desc}
                </p>
              </div>
            ))}
          </div>
        </section>

        {/* Final CTA */}
        <section
          style={{
            textAlign: 'center',
            padding: '0 clamp(20px,5vw,52px) 100px',
            maxWidth: 640,
            margin: '0 auto'
          }}
        >
          <div
            style={{
              padding: '40px 32px',
              borderRadius: 20,
              border: '1px solid rgba(247,201,72,0.2)',
              background: 'rgba(247,201,72,0.04)'
            }}
          >
            <EarnCoin size={52} />
            <h2
              style={{
                fontSize: 26,
                fontWeight: 600,
                letterSpacing: '-0.02em',
                margin: '18px 0 10px'
              }}
            >
              Ready to brief the team?
            </h2>
            <p style={{ fontSize: 14, color: 'var(--fg-3)', lineHeight: 1.65, margin: '0 0 24px' }}>
              Join the waitlist and reserve your desk. The first 100 operators get Founding Operator
              access and airdrop eligibility.
            </p>
            <Link
              href="/waitlist"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 8,
                padding: '13px 26px',
                borderRadius: 14,
                fontSize: 15,
                fontWeight: 600,
                background: 'linear-gradient(135deg,#F7C948,#E5A823)',
                color: '#070b14',
                textDecoration: 'none'
              }}
            >
              Join the waitlist <ArrowRight size={16} />
            </Link>
          </div>
        </section>
      </main>

      {/* Footer */}
      <footer
        style={{
          position: 'relative',
          zIndex: 1,
          borderTop: '1px solid rgba(255,255,255,0.06)',
          padding: '24px clamp(20px,5vw,52px)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: 12
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            fontSize: 13,
            color: 'var(--fg-4)'
          }}
        >
          <EarnCoin size={22} />
          <span>
            <b style={{ color: 'var(--fg-2)' }}>Earn</b> — COO of your live AI executive team.
          </span>
        </div>
        <div style={{ display: 'flex', gap: 16, fontSize: 12, color: 'var(--fg-5)' }}>
          <Link href="/privacy" style={{ color: 'inherit', textDecoration: 'none' }}>
            Privacy
          </Link>
          <Link href="/terms" style={{ color: 'inherit', textDecoration: 'none' }}>
            Terms
          </Link>
          <Link href="/airdrop" style={{ color: 'inherit', textDecoration: 'none' }}>
            Airdrop
          </Link>
        </div>
      </footer>
    </div>
  );
}
