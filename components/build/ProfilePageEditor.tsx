"use client";

import { useState } from "react";
import Link from "next/link";
import { saveOrgProfile } from "@/app/(app)/build/profile/actions";
import { ProfileForm, type ProfileValues } from "@/components/build/ProfileForm";
import { ProfilePreviewCard } from "@/components/build/ProfilePreviewCard";

// Standalone /build/profile editor. Holds the live form values so the
// investor "profile card preview" below the form updates as the operator types
// and reflects the saved state after Save.
export function ProfilePageEditor({
  values,
  discoverable,
}: {
  values: ProfileValues;
  discoverable?: boolean;
}) {
  const [live, setLive] = useState<ProfileValues>(values);

  return (
    <>
      <ProfileForm
        action={saveOrgProfile}
        values={values}
        showPreview={false}
        onValuesChange={setLive}
      />

      <div className="mt-6">
        <Link
          href="/settings"
          className="text-sm text-fg-muted transition hover:text-fg-secondary"
        >
          ← Back to settings
        </Link>
      </div>

      {/* Investor preview — live from the editor's current values. */}
      <div className="mt-12 border-t border-line pt-10">
        <span className="font-mono text-[10px] uppercase tracking-widest text-gold-400/80">
          How counterparties see you
        </span>
        <h2 className="mt-1 font-display text-xl font-semibold tracking-tight text-fg-primary">
          Profile card preview
        </h2>
        <p className="mt-1.5 mb-5 text-sm text-fg-secondary">
          This is the card shown in match results, the Capital Map, and ecosystem search.
          It updates as you edit above.
        </p>
        <ProfilePreviewCard values={live} discoverable={discoverable} />
      </div>
    </>
  );
}
