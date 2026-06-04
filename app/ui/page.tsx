'use client';

import { useState } from 'react';
import {
  ArrowRight,
  Search,
  Sparkles,
  Plus,
  Trash2,
  LayoutDashboard,
  TrendingUp,
  Bell
} from 'lucide-react';
import {
  Avatar,
  Badge,
  Button,
  Card,
  Input,
  ProgressBar,
  SectionTitle,
  SegTabs,
  Select,
  type BadgeTone,
  type ButtonVariant,
  type TabItem
} from '@/components/ui';

const BUTTON_VARIANTS: ButtonVariant[] = [
  'primary',
  'secondary',
  'outline',
  'ghost',
  'gold',
  'danger'
];

const BADGE_TONES: BadgeTone[] = [
  'neutral',
  'gold',
  'azure',
  'success',
  'warning',
  'danger',
  'info'
];

const TABS: TabItem[] = [
  { id: 'overview', label: 'Overview', icon: LayoutDashboard },
  { id: 'pipeline', label: 'Pipeline', icon: TrendingUp, count: 8 },
  { id: 'alerts', label: 'Alerts', icon: Bell, count: 3 }
];

export default function StyleguidePage() {
  const [activeTab, setActiveTab] = useState('overview');

  return (
    <main className="min-h-screen bg-bg-0 text-fg-1">
      <div className="mx-auto max-w-6xl px-6 py-16">
        <header className="mb-12">
          <div className="mb-1.5 text-[10.5px] font-semibold uppercase tracking-[0.11em] text-fg-4">
            FundExecs OS
          </div>
          <h1 className="text-3xl font-semibold tracking-tight">UI component library</h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-fg-3">
            Typed primitives ported from the design system. Dark institutional fintech — white-alpha
            surfaces, slate text ramp, white primary buttons, gold reserved for the Earn Copilot and
            gamification.
          </p>
        </header>

        {/* Buttons */}
        <section className="mb-12">
          <SectionTitle eyebrow="Actions" title="Button" />
          <Card>
            <div className="mb-6 flex flex-wrap items-center gap-3">
              {BUTTON_VARIANTS.map((variant) => (
                <Button key={variant} variant={variant}>
                  {variant}
                </Button>
              ))}
            </div>
            <div className="mb-6 flex flex-wrap items-center gap-3">
              <Button size="sm">Small</Button>
              <Button size="md">Medium</Button>
              <Button size="lg">Large</Button>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <Button variant="primary" iconRight={ArrowRight}>
                Continue
              </Button>
              <Button variant="secondary" icon={Search}>
                Search
              </Button>
              <Button variant="gold" icon={Sparkles}>
                Ask Earn
              </Button>
              <Button variant="outline" icon={Plus}>
                Add deal
              </Button>
              <Button variant="danger" icon={Trash2}>
                Delete
              </Button>
              <Button disabled>Disabled</Button>
            </div>
          </Card>
        </section>

        {/* Badges */}
        <section className="mb-12">
          <SectionTitle eyebrow="Status" title="Badge" />
          <Card>
            <div className="mb-6 flex flex-wrap items-center gap-2.5">
              {BADGE_TONES.map((tone) => (
                <Badge key={tone} tone={tone}>
                  {tone}
                </Badge>
              ))}
            </div>
            <div className="flex flex-wrap items-center gap-2.5">
              <Badge tone="success" dot>
                Live
              </Badge>
              <Badge tone="danger" dot pulse>
                Synergy alert
              </Badge>
              <Badge tone="gold" dot>
                Level 4
              </Badge>
            </div>
          </Card>
        </section>

        {/* Cards */}
        <section className="mb-12">
          <SectionTitle eyebrow="Surfaces" title="Card" />
          <div className="grid gap-4 md:grid-cols-2">
            <Card>
              <p className="text-sm font-medium text-fg-1">Static card</p>
              <p className="mt-2 text-sm leading-6 text-fg-3">
                Hairline border, white-alpha fill, soft shadow with a top highlight.
              </p>
            </Card>
            <Card clickable>
              <p className="text-sm font-medium text-fg-1">Clickable card</p>
              <p className="mt-2 text-sm leading-6 text-fg-3">
                Hover to see the lift — fill brightens and the card rises slightly.
              </p>
            </Card>
          </div>
        </section>

        {/* Tabs */}
        <section className="mb-12">
          <SectionTitle eyebrow="Navigation" title="SegTabs" />
          <Card>
            <SegTabs tabs={TABS} active={activeTab} onChange={setActiveTab} />
            <p className="mt-4 text-sm text-fg-3">
              Active tab: <span className="text-fg-1">{activeTab}</span>
            </p>
          </Card>
        </section>

        {/* Progress */}
        <section className="mb-12">
          <SectionTitle eyebrow="Feedback" title="ProgressBar" />
          <Card>
            <div className="flex flex-col gap-5">
              <div>
                <p className="mb-2 text-[12.5px] font-medium text-fg-3">Fund Readiness — 72%</p>
                <ProgressBar value={72} />
              </div>
              <div>
                <p className="mb-2 text-[12.5px] font-medium text-fg-3">Allocation — 40%</p>
                <ProgressBar value={40} color="var(--azure-1)" height={8} />
              </div>
              <div>
                <p className="mb-2 text-[12.5px] font-medium text-fg-3">XP to next level — 90%</p>
                <ProgressBar value={90} gradient="linear-gradient(90deg,#F7C948,#E5A823)" />
              </div>
            </div>
          </Card>
        </section>

        {/* Avatars */}
        <section className="mb-12">
          <SectionTitle eyebrow="Identity" title="Avatar" />
          <Card>
            <div className="flex flex-wrap items-center gap-4">
              <Avatar name="Earnest Fundmaker" tone="gold" />
              <Avatar name="Ada Lovelace" tone="azure" size={40} />
              <Avatar name="Marcus Bey" tone="success" size={48} />
              <Avatar name="Tariq Idris" tone="info" size={32} />
              <Avatar name="Nadia Okonkwo" tone="warning" size={56} />
            </div>
          </Card>
        </section>

        {/* Fields */}
        <section className="mb-12">
          <SectionTitle eyebrow="Inputs" title="Field" />
          <Card>
            <div className="grid gap-5 md:grid-cols-2">
              <Input label="Work email" type="email" placeholder="you@beygroupintl.com" />
              <Input label="Search deals" icon={Search} placeholder="Search the pipeline" />
              <Input
                label="Fund name"
                placeholder="Acme Capital I"
                hint="Shown across the Command Center."
              />
              <Select
                label="Stage"
                placeholder="Select a stage"
                options={['Sourcing', 'Diligence', 'IC Review', 'Closed']}
              />
            </div>
          </Card>
        </section>

        {/* SectionTitle with action */}
        <section className="mb-12">
          <SectionTitle
            eyebrow="Layout"
            title="SectionTitle"
            action={
              <Button variant="ghost" size="sm" iconRight={ArrowRight}>
                View all
              </Button>
            }
          />
          <Card>
            <p className="text-sm leading-6 text-fg-3">
              The header above pairs an all-caps eyebrow, an h2-scale title, and an optional
              trailing action aligned to the baseline.
            </p>
          </Card>
        </section>
      </div>
    </main>
  );
}
