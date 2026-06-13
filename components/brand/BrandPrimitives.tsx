// components/brand/BrandPrimitives.tsx
// Shared branding primitives — EarnCoin orb + FundExecs OS wordmark
// Extracted to prevent drift across landing, waitlist, and airdrop pages

import Image from 'next/image';
import earnCoin from '@/public/earn-coin.png';

export function EarnCoin({ size = 40 }: { size?: number }) {
  return (
    <span
      style={{
        width: size,
        height: size,
        borderRadius: '50%',
        background: '#fff',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
        overflow: 'hidden',
        boxShadow: '0 2px 12px -2px rgba(247,201,72,0.55)'
      }}
    >
      <Image
        src={earnCoin}
        alt="Earn"
        width={size}
        height={size}
        style={{ width: size, height: size, objectFit: 'contain' }}
        priority
      />
    </span>
  );
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
