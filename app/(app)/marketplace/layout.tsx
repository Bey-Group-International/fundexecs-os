import { FeatureLockBanner } from "@/components/FeatureLockBanner";

// Every marketplace page stays browsable; the banner explains why its actions are
// locked for an org without a paid plan (see lib/feature-access).
export default function MarketplaceLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <div className="mx-auto max-w-5xl">
        <FeatureLockBanner feature="marketplace" />
      </div>
      {children}
    </>
  );
}
