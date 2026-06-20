import Image from "next/image";

// The Earn brand mark rendered as a living orb: the Earn coin floating inside a
// soft gold halo, ringed by a hairline and lit from the upper-left so it reads
// as a sphere rather than a flat icon. Used wherever Earn "appears" — the
// copilot dock header, its launcher, and the routing indicator. `pulse` adds the
// slow ambient breathing glow for active/attention states.
export function EarnOrb({
  size = 28,
  pulse = false,
  className = "",
}: {
  size?: number;
  pulse?: boolean;
  className?: string;
}) {
  return (
    <span
      className={`relative inline-flex shrink-0 items-center justify-center rounded-full ${className}`}
      style={{ width: size, height: size }}
      aria-hidden
    >
      {/* Ambient halo behind the orb. */}
      <span
        className={`absolute -inset-1 rounded-full bg-gold-400/25 blur-md ${pulse ? "animate-glow" : ""}`}
      />
      {/* Orb body: the coin over a radial gold core, ringed and inset-lit so it
          has real spherical depth. */}
      <span className="relative flex h-full w-full items-center justify-center overflow-hidden rounded-full border border-gold-500/50 bg-[radial-gradient(circle_at_30%_25%,rgba(228,205,147,0.5),rgba(20,19,16,0.92))] shadow-[inset_0_1px_2px_rgba(255,255,255,0.18),0_2px_10px_-2px_rgba(196,151,74,0.6)]">
        <Image
          src="/earn-coin.png"
          alt="Earn"
          width={size}
          height={size}
          className="h-[78%] w-[78%] rounded-full object-contain"
          priority
        />
      </span>
    </span>
  );
}
