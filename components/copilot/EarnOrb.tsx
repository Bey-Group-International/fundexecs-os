import Image from "next/image";

// The Earn brand mark rendered as a living orb: the Earn coin floating inside a
// neural green halo, ringed by a hairline and lit from the upper-left so it
// reads as a sphere rather than a flat icon. Used wherever Earn "appears" in the
// copilot dock. `pulse` adds the slow boot aura for active/attention states.
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
        className={`absolute -inset-1 rounded-full bg-neural-400/30 blur-md ${pulse ? "animate-boot" : ""}`}
      />
      {/* Orb body: the coin over a radial gold core, ringed and inset-lit so it
          has real spherical depth. */}
      <span className="relative flex h-full w-full items-center justify-center overflow-hidden rounded-full border border-neural-400/60 bg-[radial-gradient(circle_at_30%_25%,rgba(199,255,107,0.34),rgba(7,12,5,0.94))] shadow-[inset_0_1px_2px_rgba(255,255,255,0.18),0_2px_14px_-2px_rgba(118,185,0,0.85)]">
        <span className="absolute inset-0 bg-[linear-gradient(120deg,transparent_35%,rgba(199,255,107,0.18)_50%,transparent_65%)]" />
        <Image
          src="/earn-coin.png"
          alt="Earn"
          width={size}
          height={size}
          className="relative h-[78%] w-[78%] rounded-full object-contain"
          priority
        />
      </span>
    </span>
  );
}
