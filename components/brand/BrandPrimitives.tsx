// components/brand/BrandPrimitives.tsx
// Shared branding primitives — EarnCoin orb + FundExecs OS wordmark
// Extracted to prevent drift across landing, waitlist, and airdrop pages

export function EarnCoin({ size = 40 }: { size?: number }) {
  return (
    <span
      style={{
        width: size,
        height: size,
        borderRadius: '50%',
        background: '#F7C948',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0
      }}
    >
      <span style={{ fontSize: size * 0.52, fontWeight: 700, color: '#070b14' }}>$</span>
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
