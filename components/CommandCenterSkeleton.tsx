"use client";

// components/CommandCenterSkeleton.tsx
// Animated loading skeleton for CommandCenter — matches Intelligence Strip + NBA panel layout.

function SkeletonBar({ className = "" }: { className?: string }) {
  return <div className={`animate-pulse rounded bg-surface-2 ${className}`} />;
}

function InsightCardSkeleton() {
  return (
    <div className="flex min-w-[260px] max-w-[300px] shrink-0 flex-col gap-2 rounded-xl border border-line bg-surface-2/40 p-3.5">
      <div className="flex items-center gap-2">
        <div className="h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-surface-2" />
        <SkeletonBar className="h-4 w-16" />
        <div className="ml-auto h-4 w-4 animate-pulse rounded bg-surface-2" />
      </div>
      <SkeletonBar className="h-4 w-full" />
      <SkeletonBar className="h-3 w-4/5" />
      <SkeletonBar className="mt-1 h-3 w-20" />
    </div>
  );
}

function NBACardSkeleton() {
  return (
    <div className="rounded-2xl border border-line bg-surface-1 p-4">
      <div className="flex items-start gap-3">
        <div className="h-9 w-9 animate-pulse rounded-xl bg-surface-2" />
        <div className="flex flex-1 flex-col gap-2">
          <SkeletonBar className="h-4 w-3/4" />
          <SkeletonBar className="h-3 w-full" />
          <SkeletonBar className="h-3 w-2/3" />
        </div>
        <SkeletonBar className="h-7 w-16 shrink-0" />
      </div>
    </div>
  );
}

export function CommandCenterSkeleton() {
  return (
    <div className="flex flex-col gap-6" aria-busy="true" aria-label="Loading command center">
      {/* Intelligence Strip skeleton */}
      <section>
        <div className="mb-2 flex items-center justify-between">
          <SkeletonBar className="h-3 w-28" />
          <SkeletonBar className="h-3 w-12" />
        </div>
        <div className="flex gap-3 overflow-x-hidden pb-1">
          <InsightCardSkeleton />
          <InsightCardSkeleton />
          <InsightCardSkeleton />
        </div>
      </section>

      {/* NBA panel skeleton */}
      <section>
        <div className="mb-3 flex items-center justify-between">
          <SkeletonBar className="h-3 w-32" />
          <SkeletonBar className="h-3 w-16" />
        </div>
        <div className="flex flex-col gap-3">
          <NBACardSkeleton />
          <NBACardSkeleton />
          <NBACardSkeleton />
        </div>
      </section>
    </div>
  );
}
