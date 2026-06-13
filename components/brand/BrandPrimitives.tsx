// components/brand/BrandPrimitives.tsx
// Shared branding primitives — EarnCoin orb + FundExecs OS wordmark
// Extracted to prevent drift across landing, waitlist, and airdrop pages

import { EarnCoin as EarnCoinUI } from '@/components/ui/EarnCoin';

export function EarnCoin({ size = 40, glow = false }: { size?: number; glow?: boolean }) {
  return <EarnCoinUI size={size} glow={glow} />;
}

export function Wordmark({ size = 19 }: { size?: number }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 11 }}>
      <EarnCoin size={Math.round(size * 1.7)} />
      <div style={{ fontSize: size, fontWeight: 600, letterSpacing: '-0.02em' }}>
        FundExecs <span style={{ color: 'var(--fg-4)', fontWeight: 500 }}>OS</span>
      </div>
    </div>
  );
}
