// app/page.tsx
// FundExecs OS — Landing page (Server Component)

import Link from 'next/link';
import {
  ArrowRight,
  Lock,
  Sparkles,
  Shield,
  Zap,
  BarChart3,
  Users,
  PhoneCall,
  CheckCircle2,
  TrendingUp,
  Bell,
  Search,
  FileText,
  DollarSign,
  Activity
} from 'lucide-react';
import { EarnCoin, Wordmark } from '@/components/brand/BrandPrimitives';
import { EarnRunner } from '@/components/ui/EarnRunner';

/* ── Live activity ticker ── */
const TICKER_ITEMS = [
  '🟢 Sterling · Drafted LP update deck — 3 slides ready for review',
  '🔵 Marcus · Sourced 4 new deal candidates from PitchBook scan',
  '🟡 Earn · Capital map updated — $12M gap identified in Series B slot',
  '🟢 Sloane · Wire instructions sent to Apex Capital Partners',
  '🔵 Adrian · NDA reviewed and flagged two non-standard clauses',
  '🟡 Eleanor · LP quarterly report queued — send by EOD Friday',
  '🟢 Priya · Term sheet benchmarked against 14 comparable closes',
  '🔵 Earn · Command center updated — 3 ranked priorities for today'
];

function LiveTicker() {
  return (
    <div
      style={{
        width: '100%',
        overflow: 'hidden',
        borderTop: '1px solid rgba(247,201,72,0.15)',
        borderBottom: '1px solid rgba(247,201,72,0.15)',
        background: 'rgba(247,201,72,0.04)',
        padding: '10px 0',
        position: 'relative'
      }}
    >
      <div
        style={{
          display: 'flex',
          gap: 48,
          animation: 'ticker 40s linear infinite',
          whiteSpace: 'nowrap',
          willChange: 'transform'
        }}
      >
        {[...TICKER_ITEMS, ...TICKER_ITEMS].map((item, i) => (
          <span
            key={i}
            style={{
              fontSize: 12,
              color: 'var(--fg-3)',
              flexShrink: 0,
              display: 'inline-flex',
              alignItems: 'center',
              gap: 8
            }}
          >
            <span
              style={{
                fontSize: 9,
                fontWeight: 700,
                letterSpacing: '0.08em',
                textTransform: 'uppercase',
                color: '#F7C948',
                opacity: 0.7
              }}
            >
              LIVE
            </span>
            {item}
          </span>
        ))}
      </div>
    </div>
  );
}

/* ── Specialist chip ── */
function Chip({ name, role, tone = 'azure' }: { name: string; role: string; tone?: string }) {
  const colors: Record<string, { bg: string; border: string; text: string }> = {
    gold: { bg: 'rgba(247,201,72,0.12)', border: 'rgba(247,201,72,0.3)', text: '#F7C948' },
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

const DONE_FOR_YOU: [string, string, string][] = [
  [
    '01',
    'You brief the mandate',
    "A two-minute brief — who you are, what you're raising, where you play."
  ],
  [
    '02',
    'The executive team does it for you',
    'Fifteen specialists source the deals, structure the vehicle, prep the data room, and run investor outreach.'
  ],
  [
    '03',
    'You approve and close',
    'Every move waits on your sign-off behind a four-layer Chain of Trust — you approve, they execute, the raise closes.'
  ]
];

/* ── OS Simulation ── */
function OSSimulation() {
  const tasks = [
    {
      agent: 'Sterling',
      action: 'LP Update Ready',
      detail: 'Q2 deck — 12 slides, 3 charts. Waiting approval.',
      status: 'pending',
      color: '#60a5fa'
    },
    {
      agent: 'Marcus',
      action: 'Deal Sourced',
      detail: 'Nexus Ventures — $8M Series A, strong fit',
      status: 'done',
      color: '#34d399'
    },
    {
      agent: 'Earn',
      action: 'Capital Gap Identified',
      detail: '$12M open in Series B slot — 4 investors shortlisted',
      status: 'insight',
      color: '#F7C948'
    },
    {
      agent: 'Sloane',
      action: 'Term Sheet Drafted',
      detail: 'Benchmarked against 14 comparable closes',
      status: 'pending',
      color: '#60a5fa'
    },
    {
      agent: 'Adrian',
      action: 'NDA Reviewed',
      detail: '2 non-standard clauses flagged — review needed',
      status: 'alert',
      color: '#f87171'
    }
  ];

  const statusBadge: Record<string, { label: string; bg: string; text: string }> = {
    pending: { label: 'Needs Review', bg: 'rgba(96,165,250,0.12)', text: '#60a5fa' },
    done: { label: 'Done', bg: 'rgba(52,211,153,0.12)', text: '#34d399' },
    insight: { label: 'Insight', bg: 'rgba(247,201,72,0.12)', text: '#F7C948' },
    alert: { label: 'Alert', bg: 'rgba(248,113,113,0.12)', text: '#f87171' }
  };

  return (
    <div
      style={{
        borderRadius: 20,
        border: '1px solid rgba(255,255,255,0.08)',
        background: 'rgba(7,11,20,0.9)',
        backdropFilter: 'blur(12px)',
        overflow: 'hidden',
        boxShadow:
          '0 0 0 1px rgba(247,201,72,0.08), 0 32px 64px -16px rgba(0,0,0,0.6), 0 0 80px -20px rgba(247,201,72,0.08)'
      }}
    >
      {/* Window chrome */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '12px 16px',
          borderBottom: '1px solid rgba(255,255,255,0.06)',
          background: 'rgba(255,255,255,0.02)'
        }}
      >
        <span style={{ width: 10, height: 10, borderRadius: 999, background: '#f87171' }} />
        <span style={{ width: 10, height: 10, borderRadius: 999, background: '#fbbf24' }} />
        <span style={{ width: 10, height: 10, borderRadius: 999, background: '#34d399' }} />
        <span
          style={{
            marginLeft: 8,
            fontSize: 11,
            color: 'var(--fg-5)',
            fontWeight: 500,
            letterSpacing: '0.01em'
          }}
        >
          FundExecs OS · Command Center
        </span>
        <span
          style={{
            marginLeft: 'auto',
            display: 'inline-flex',
            alignItems: 'center',
            gap: 5,
            fontSize: 10,
            color: '#34d399',
            fontWeight: 600
          }}
        >
          <span
            style={{
              width: 6,
              height: 6,
              borderRadius: 999,
              background: '#34d399',
              animation: 'pulse 2s infinite'
            }}
          />
          15 specialists active
        </span>
      </div>

      {/* Earn header bar */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          padding: '14px 16px',
          borderBottom: '1px solid rgba(255,255,255,0.05)',
          background: 'rgba(247,201,72,0.03)'
        }}
      >
        <EarnCoin size={36} />
        <div>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--fg-1)' }}>
            Good morning — here&apos;s what your team surfaced overnight.
          </div>
          <div style={{ fontSize: 11, color: 'var(--fg-4)', marginTop: 2 }}>
            Earn · COO · 5 items need your attention
          </div>
        </div>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 5,
              padding: '4px 10px',
              borderRadius: 999,
              background: 'rgba(247,201,72,0.1)',
              border: '1px solid rgba(247,201,72,0.2)',
              fontSize: 11,
              fontWeight: 600,
              color: '#F7C948'
            }}
          >
            <Activity size={10} /> Live
          </span>
        </div>
      </div>

      {/* Task feed */}
      <div style={{ padding: '8px 0' }}>
        {tasks.map((t, i) => {
          const badge = statusBadge[t.status];
          return (
            <div
              key={i}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 12,
                padding: '10px 16px',
                borderBottom:
                  i < tasks.length - 1 ? '1px solid rgba(255,255,255,0.04)' : undefined,
                transition: 'background 0.15s'
              }}
            >
              <span
                style={{
                  width: 28,
                  height: 28,
                  borderRadius: 8,
                  background: `${t.color}18`,
                  border: `1px solid ${t.color}30`,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 10,
                  fontWeight: 700,
                  color: t.color,
                  flexShrink: 0
                }}
              >
                {t.agent[0]}
              </span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--fg-1)' }}>
                    {t.agent}
                  </span>
                  <span style={{ fontSize: 12, color: 'var(--fg-3)' }}>· {t.action}</span>
                </div>
                <div
                  style={{
                    fontSize: 11,
                    color: 'var(--fg-5)',
                    marginTop: 2,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap'
                  }}
                >
                  {t.detail}
                </div>
              </div>
              <span
                style={{
                  padding: '3px 8px',
                  borderRadius: 999,
                  fontSize: 10,
                  fontWeight: 600,
                  background: badge.bg,
                  color: badge.text,
                  flexShrink: 0
                }}
              >
                {badge.label}
              </span>
            </div>
          );
        })}
      </div>

      {/* Bottom nav sim */}
      <div
        style={{
          display: 'flex',
          gap: 4,
          padding: '10px 16px',
          borderTop: '1px solid rgba(255,255,255,0.06)',
          background: 'rgba(255,255,255,0.01)'
        }}
      >
        {[
          { icon: <BarChart3 size={12} />, label: 'Command' },
          { icon: <Search size={12} />, label: 'Source' },
          { icon: <FileText size={12} />, label: 'Diligence' },
          { icon: <DollarSign size={12} />, label: 'Execute' },
          { icon: <TrendingUp size={12} />, label: 'Build' }
        ].map((nav, i) => (
          <div
            key={i}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 5,
              padding: '5px 10px',
              borderRadius: 8,
              background: i === 0 ? 'rgba(247,201,72,0.1)' : 'transparent',
              border: i === 0 ? '1px solid rgba(247,201,72,0.2)' : '1px solid transparent',
              fontSize: 11,
              fontWeight: i === 0 ? 600 : 400,
              color: i === 0 ? '#F7C948' : 'var(--fg-5)',
              cursor: 'default'
            }}
          >
            {nav.icon}
            {nav.label}
          </div>
        ))}
      </div>
    </div>
  );
}

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
      {/* Gold radial glow */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          pointerEvents: 'none',
          background:
            'radial-gradient(60% 50% at 50% 0%, rgba(247,201,72,0.09), transparent 70%)'
        }}
      />
      {/* Blue accent glow bottom-left */}
      <div
        style={{
          position: 'absolute',
          bottom: 0,
          left: 0,
          width: '40%',
          height: '40%',
          pointerEvents: 'none',
          background: 'radial-gradient(circle at 0% 100%, rgba(91,141,239,0.08), transparent 70%)'
        }}
      />

      {/* Signature activity bar */}
      <div style={{ position: 'relative', zIndex: 20 }}>
        <LiveTicker />
      </div>

      {/* Nav */}
      <header
        style={{
          position: 'relative',
          zIndex: 10,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '18px clamp(20px,5vw,52px)',
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
            Book a call
          </Link>
          <Link
            href="/login"
            style={{
              fontSize: 13,
              color: '#070b14',
              padding: '8px 14px',
              borderRadius: 10,
              background: 'linear-gradient(135deg,#F7C948,#E5A823)',
              textDecoration: 'none',
              fontWeight: 600
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
            padding: 'clamp(48px,7vh,80px) clamp(20px,5vw,52px) 56px',
            maxWidth: 960,
            margin: '0 auto'
          }}
        >
          {/* Hero mascot — Earn orb */}
          <div style={{ marginBottom: 20, position: 'relative' }}>
            {/* Outer glow ring */}
            <div
              aria-hidden
              style={{
                position: 'absolute',
                inset: -20,
                borderRadius: '50%',
                background: 'radial-gradient(circle, rgba(247,201,72,0.22), transparent 70%)',
                filter: 'blur(12px)'
              }}
            />
            <EarnRunner size={112} glow />
          </div>

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
              fontSize: 'clamp(36px,6vw,66px)',
              lineHeight: 1.04,
              fontWeight: 700,
              letterSpacing: '-0.035em',
              margin: '0 0 24px'
            }}
          >
            Set the mandate.
            <br />
            Your AI executive team{' '}
            <span
              style={{
                color: '#F7C948',
                textShadow: '0 0 40px rgba(247,201,72,0.4)'
              }}
            >
              does the rest.
            </span>
          </h1>

          <p
            style={{
              fontSize: 'clamp(15px,1.8vw,18px)',
              lineHeight: 1.7,
              color: 'var(--fg-3)',
              maxWidth: 620,
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
                padding: '13px 26px',
                borderRadius: 14,
                fontSize: 15,
                fontWeight: 700,
                background: 'linear-gradient(135deg,#F7C948,#E5A823)',
                color: '#070b14',
                textDecoration: 'none',
                boxShadow: '0 8px 28px -8px rgba(247,201,72,0.55), 0 0 0 1px rgba(247,201,72,0.2)'
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
                padding: '13px 26px',
                borderRadius: 14,
                fontSize: 15,
                fontWeight: 500,
                background: 'rgba(255,255,255,0.06)',
                color: '#f1f5f9',
                border: '1px solid rgba(255,255,255,0.12)',
                textDecoration: 'none'
              }}
            >
              <PhoneCall size={16} /> Book a strategy call
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
                    color: '#F7C948',
                    textShadow: '0 0 24px rgba(247,201,72,0.35)'
                  }}
                >
                  {v}
                </div>
                <div style={{ fontSize: 12, color: 'var(--fg-4)', marginTop: 4 }}>{l}</div>
              </div>
            ))}
          </div>
        </section>

        {/* Live OS Demo Section */}
        <section
          style={{
            padding: '0 clamp(20px,5vw,52px) 80px',
            maxWidth: 900,
            margin: '0 auto'
          }}
        >
          <div style={{ textAlign: 'center', marginBottom: 32 }}>
            <div
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                padding: '4px 12px',
                borderRadius: 999,
                border: '1px solid rgba(52,211,153,0.25)',
                background: 'rgba(52,211,153,0.06)',
                fontSize: 11,
                fontWeight: 700,
                color: '#34d399',
                letterSpacing: '0.06em',
                textTransform: 'uppercase',
                marginBottom: 14
              }}
            >
              <span
                style={{
                  width: 6,
                  height: 6,
                  borderRadius: 999,
                  background: '#34d399',
                  animation: 'pulse 2s infinite'
                }}
              />
              Live simulation
            </div>
            <div style={{ fontSize: 'clamp(18px,2.5vw,24px)', fontWeight: 600, letterSpacing: '-0.02em' }}>
              Your team is already working.
            </div>
            <p style={{ fontSize: 14, color: 'var(--fg-4)', marginTop: 8, maxWidth: 480, margin: '8px auto 0' }}>
              This is a live simulation of the FundExecs OS command center — the view waiting for
              you when you sign in.
            </p>
          </div>
          <OSSimulation />
        </section>

        {/* Done-for-you band */}
        <section
          style={{ padding: '0 clamp(20px,5vw,52px) 72px', maxWidth: 1080, margin: '0 auto' }}
        >
          <div style={{ textAlign: 'center', marginBottom: 36 }}>
            <div
              style={{
                fontSize: 11,
                letterSpacing: '0.08em',
                textTransform: 'uppercase',
                color: 'var(--fg-5)',
                marginBottom: 8
              }}
            >
              Done for you
            </div>
            <div style={{ fontSize: 'clamp(18px,2.5vw,24px)', fontWeight: 600, letterSpacing: '-0.02em' }}>
              You don&apos;t run the raise. Your team does.
            </div>
          </div>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
              gap: 16
            }}
          >
            {DONE_FOR_YOU.map(([n, title, desc]) => (
              <div
                key={n}
                style={{
                  padding: '24px 22px',
                  borderRadius: 16,
                  border: '1px solid rgba(247,201,72,0.18)',
                  background: 'rgba(247,201,72,0.04)',
                  position: 'relative',
                  overflow: 'hidden'
                }}
              >
                {/* subtle corner shine */}
                <div
                  aria-hidden
                  style={{
                    position: 'absolute',
                    top: 0,
                    right: 0,
                    width: 80,
                    height: 80,
                    background: 'radial-gradient(circle at 100% 0%, rgba(247,201,72,0.08), transparent 70%)',
                    pointerEvents: 'none'
                  }}
                />
                <div
                  style={{
                    fontSize: 13,
                    fontWeight: 700,
                    color: '#F7C948',
                    letterSpacing: '0.04em',
                    marginBottom: 10
                  }}
                >
                  {n}
                </div>
                <div style={{ fontSize: 15.5, fontWeight: 600, marginBottom: 8 }}>{title}</div>
                <p style={{ fontSize: 13.5, lineHeight: 1.6, color: 'var(--fg-4)', margin: 0 }}>
                  {desc}
                </p>
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
            <div style={{ fontSize: 'clamp(18px,2.5vw,24px)', fontWeight: 600, letterSpacing: '-0.02em' }}>
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
            <div style={{ fontSize: 'clamp(18px,2.5vw,24px)', fontWeight: 600, letterSpacing: '-0.02em' }}>
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
                  backdropFilter: 'blur(4px)',
                  transition: 'border-color 0.2s',
                  position: 'relative',
                  overflow: 'hidden'
                }}
              >
                <div
                  aria-hidden
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    right: 0,
                    height: 1,
                    background: 'linear-gradient(90deg, transparent, rgba(96,165,250,0.3), transparent)'
                  }}
                />
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

        {/* Trust bar */}
        <section
          style={{
            padding: '0 clamp(20px,5vw,52px) 72px',
            maxWidth: 800,
            margin: '0 auto',
            textAlign: 'center'
          }}
        >
          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              gap: 16,
              justifyContent: 'center',
              alignItems: 'center'
            }}
          >
            {[
              { icon: <Shield size={14} />, label: 'SOC 2 Type II' },
              { icon: <Lock size={14} />, label: 'Row-Level Security' },
              { icon: <CheckCircle2 size={14} />, label: 'Supabase Auth' },
              { icon: <Bell size={14} />, label: 'Audit trail on every action' },
              { icon: <Shield size={14} />, label: '4-layer Chain of Trust' }
            ].map((t) => (
              <div
                key={t.label}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  fontSize: 12,
                  color: 'var(--fg-4)',
                  padding: '6px 12px',
                  borderRadius: 999,
                  border: '1px solid rgba(255,255,255,0.07)',
                  background: 'rgba(255,255,255,0.03)'
                }}
              >
                {t.icon} {t.label}
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
              padding: '44px 32px',
              borderRadius: 24,
              border: '1px solid rgba(247,201,72,0.22)',
              background: 'rgba(247,201,72,0.04)',
              position: 'relative',
              overflow: 'hidden'
            }}
          >
            {/* radial glow behind CTA card */}
            <div
              aria-hidden
              style={{
                position: 'absolute',
                inset: 0,
                background: 'radial-gradient(ellipse at 50% 0%, rgba(247,201,72,0.08), transparent 70%)',
                pointerEvents: 'none'
              }}
            />
            <div style={{ display: 'flex', justifyContent: 'center', position: 'relative' }}>
              <EarnRunner size={88} glow />
            </div>
            <h2
              style={{
                fontSize: 'clamp(22px,3vw,28px)',
                fontWeight: 700,
                letterSpacing: '-0.025em',
                margin: '18px 0 10px',
                position: 'relative'
              }}
            >
              Brief the team. They do the rest.
            </h2>
            <p
              style={{
                fontSize: 14,
                color: 'var(--fg-3)',
                lineHeight: 1.65,
                margin: '0 0 28px',
                position: 'relative'
              }}
            >
              Set your mandate once — the executive team sources, structures, and drives every
              engagement to a signed close. Reserve your desk, or book a call and we&apos;ll map
              your raise live.
            </p>
            <div
              style={{
                display: 'flex',
                gap: 12,
                flexWrap: 'wrap',
                justifyContent: 'center',
                position: 'relative'
              }}
            >
              <Link
                href="/waitlist"
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '13px 26px',
                  borderRadius: 14,
                  fontSize: 15,
                  fontWeight: 700,
                  background: 'linear-gradient(135deg,#F7C948,#E5A823)',
                  color: '#070b14',
                  textDecoration: 'none',
                  boxShadow: '0 8px 28px -8px rgba(247,201,72,0.55)'
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
                  padding: '13px 26px',
                  borderRadius: 14,
                  fontSize: 15,
                  fontWeight: 500,
                  background: 'rgba(255,255,255,0.06)',
                  color: '#f1f5f9',
                  border: '1px solid rgba(255,255,255,0.1)',
                  textDecoration: 'none'
                }}
              >
                <PhoneCall size={15} /> Book a strategy call
              </Link>
            </div>
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
          <EarnCoin size={24} />
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
            Book a call
          </Link>
        </div>
      </footer>

      <style>{`
        @keyframes ticker {
          0% { transform: translateX(0); }
          100% { transform: translateX(-50%); }
        }
      `}</style>
    </div>
  );
}
