"use client";

import { useRef, useState, useTransition } from "react";
import type { MemberRole } from "@/lib/supabase/database.types";
import { avatarInitial, safeAvatarUrl } from "@/lib/avatar";
import { MAX_BIO_LENGTH } from "@/lib/member-profile";
import { AvatarUpload } from "@/components/shared/AvatarUpload";
import { inputClass } from "./DraftWithEarn";
import {
  updateMyProfile,
  assignTeamTask,
  changeMemberRole,
  removeMember,
  inviteMember,
} from "./team-actions";

export interface TeamMemberView {
  memberId: string;
  principalId: string;
  name: string;
  email: string;
  title: string | null;
  bio: string | null;
  avatarUrl: string | null;
  role: MemberRole;
}

export interface SeatInfo {
  used: number;
  /** Seat allotment for the current plan. `null` = unlimited. */
  limit: number | null;
}

interface TeamControlsProps {
  members: TeamMemberView[];
  currentUserId: string;
  currentRole: MemberRole | null;
  ownProfile: {
    full_name: string | null;
    title: string | null;
    bio: string | null;
    avatar_url: string | null;
  };
  seats: SeatInfo;
}

const ROLE_OPTIONS: MemberRole[] = ["owner", "admin", "member"];
const HUB_OPTIONS = [
  { value: "", label: "No hub" },
  { value: "build", label: "Build" },
  { value: "source", label: "Source" },
  { value: "run", label: "Run" },
  { value: "execute", label: "Execute" },
];
const PRIORITY_OPTIONS = ["low", "normal", "high", "urgent"];

// Photos are uploaded files we host, never arbitrary URLs. `safeAvatarUrl`
// accepts only a public object URL from our own member-avatars bucket and
// re-emits it via the URL constructor, which breaks the taint flow into the
// <img> sink (CodeQL js/xss-through-dom). Anything else falls back to initials.
function Avatar({
  name,
  avatarUrl,
}: {
  name: string;
  avatarUrl?: string | null;
}) {
  const safe = safeAvatarUrl(avatarUrl);
  if (safe) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={safe}
        alt={name}
        className="h-9 w-9 shrink-0 rounded-full object-cover"
      />
    );
  }
  return (
    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gold-500/20 text-sm font-medium text-gold-300">
      {avatarInitial(name)}
    </span>
  );
}

const ROLE_BADGE_CLASS: Record<MemberRole, string> = {
  owner: "border-gold-500/40 bg-gold-500/15 text-gold-300",
  admin: "border-line bg-surface-2 text-fg-secondary",
  member: "border-line text-fg-muted",
  viewer: "border-line text-fg-muted",
};

function RoleBadge({ role }: { role: MemberRole }) {
  return (
    <span
      className={`rounded-full border px-2 py-0.5 font-mono text-[11px] uppercase tracking-wider ${ROLE_BADGE_CLASS[role]}`}
    >
      {role}
    </span>
  );
}

export function TeamControls({
  members,
  currentUserId,
  currentRole,
  ownProfile,
  seats,
}: TeamControlsProps) {
  const isAdmin = currentRole === "owner" || currentRole === "admin";
  const canAssign = isAdmin || currentRole === "member";
  const ownerCount = members.filter((m) => m.role === "owner").length;

  const byName = (a: TeamMemberView, b: TeamMemberView) =>
    a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
  const leaders = members
    .filter((m) => m.role === "owner" || m.role === "admin")
    .sort(byName);
  const regular = members
    .filter((m) => m.role !== "owner" && m.role !== "admin")
    .sort(byName);

  const renderMember = (m: TeamMemberView) => {
    const isSelf = m.principalId === currentUserId;
    const isLastOwner = m.role === "owner" && ownerCount <= 1;
    return isAdmin ? (
      <AdminMemberRow
        key={m.memberId}
        member={m}
        isSelf={isSelf}
        canRemove={!isSelf && !isLastOwner}
        isLastOwner={isLastOwner}
      />
    ) : (
      <ReadOnlyMemberRow key={m.memberId} member={m} isSelf={isSelf} />
    );
  };

  return (
    <div className="flex flex-col gap-6">
      <YourProfile ownProfile={ownProfile} />

      {canAssign ? <AssignTaskForm members={members} currentUserId={currentUserId} /> : null}

      {isAdmin ? <InviteForm seats={seats} /> : null}

      {leaders.length > 0 ? (
        <div className="flex flex-col gap-2">
          <p className="px-1 font-mono text-[11px] uppercase tracking-wider text-fg-muted">
            Owners &amp; Admins
          </p>
          {leaders.map(renderMember)}
        </div>
      ) : null}

      {regular.length > 0 ? (
        <div className="flex flex-col gap-2">
          <p className="px-1 font-mono text-[11px] uppercase tracking-wider text-fg-muted">
            Members
          </p>
          {regular.map(renderMember)}
        </div>
      ) : null}
    </div>
  );
}

// --- Assign tasks ----------------------------------------------------------
function AssignTaskForm({
  members,
  currentUserId,
}: {
  members: TeamMemberView[];
  currentUserId: string;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const defaultAssignee = members.some((m) => m.principalId === currentUserId)
    ? currentUserId
    : members[0]?.principalId;

  return (
    <form
      ref={formRef}
      action={(fd) => {
        setError(null);
        setSuccess(false);
        startTransition(async () => {
          const res = await assignTeamTask(fd);
          if (res.error) {
            setError(res.error);
          } else {
            setSuccess(true);
            formRef.current?.reset();
          }
        });
      }}
      className="grid gap-3 rounded-xl border border-neural-400/20 bg-neural-400/[0.04] p-4 md:grid-cols-[1.1fr_0.8fr_0.7fr]"
    >
      <div className="md:col-span-3">
        <p className="text-sm font-medium text-fg-primary">Assign team task</p>
        <p className="mt-0.5 text-xs text-fg-muted">
          Send work to a teammate&apos;s Earn dock so they can complete it with context.
        </p>
      </div>
      <input
        name="title"
        required
        placeholder="e.g. Refresh LP follow-up list"
        className={inputClass}
      />
      <select name="assigned_to" defaultValue={defaultAssignee ?? ""} className={inputClass}>
        {members.map((m) => (
          <option key={m.principalId} value={m.principalId}>
            {m.name}
          </option>
        ))}
      </select>
      <select name="priority" defaultValue="normal" className={inputClass}>
        {PRIORITY_OPTIONS.map((p) => (
          <option key={p} value={p}>
            {p}
          </option>
        ))}
      </select>
      <textarea
        name="description"
        rows={2}
        placeholder="What needs to be done?"
        className={`${inputClass} md:col-span-3`}
      />
      <select name="hub" defaultValue="" className={inputClass}>
        {HUB_OPTIONS.map((h) => (
          <option key={h.value} value={h.value}>
            {h.label}
          </option>
        ))}
      </select>
      <input
        name="module"
        placeholder="Module (optional)"
        className={inputClass}
      />
      <input
        name="due_at"
        type="date"
        className={inputClass}
      />
      <div className="flex items-center gap-3 md:col-span-3">
        <button
          disabled={pending || members.length === 0}
          className="rounded-md bg-neural-400 px-4 py-2 text-sm font-medium text-white transition hover:bg-neural-300 disabled:opacity-50"
        >
          {pending ? "Assigning…" : "Assign task"}
        </button>
        {error ? <span className="text-xs text-status-danger">{error}</span> : null}
        {success ? <span className="text-xs text-status-success">Task assigned.</span> : null}
      </div>
    </form>
  );
}

// --- Your profile ---------------------------------------------------------
// The photo is NOT part of this form. `AvatarUpload` posts the file to its own
// action the moment it is picked, so a large image never has to ride along in
// the profile submit and the operator sees the new photo immediately.
function YourProfile({
  ownProfile,
}: {
  ownProfile: {
    full_name: string | null;
    title: string | null;
    bio: string | null;
    avatar_url: string | null;
  };
}) {
  const [pending, startTransition] = useTransition();
  const [saved, setSaved] = useState(false);

  return (
    <form
      action={(fd) => {
        setSaved(false);
        startTransition(async () => {
          await updateMyProfile(fd);
          setSaved(true);
        });
      }}
      className="grid gap-3 rounded-xl border border-line bg-surface-1 p-4 sm:grid-cols-2"
    >
      <div className="sm:col-span-2">
        <p className="text-sm font-medium text-fg-primary">Your profile</p>
        <p className="mt-0.5 text-xs text-fg-muted">
          Update how your name, title, bio, and photo appear across the firm.
        </p>
      </div>

      <div className="sm:col-span-2">
        <AvatarUpload
          name={ownProfile.full_name}
          currentUrl={ownProfile.avatar_url}
          size="md"
        />
      </div>

      <input
        name="full_name"
        defaultValue={ownProfile.full_name ?? ""}
        placeholder="Full name"
        className={inputClass}
      />
      <input
        name="title"
        defaultValue={ownProfile.title ?? ""}
        placeholder="Title"
        className={inputClass}
      />
      <textarea
        name="bio"
        rows={3}
        maxLength={MAX_BIO_LENGTH}
        defaultValue={ownProfile.bio ?? ""}
        placeholder="Short bio — what you run, and the track record behind it."
        className={`${inputClass} sm:col-span-2`}
      />
      <div className="flex items-center gap-3 sm:col-span-2">
        <button
          disabled={pending}
          className="justify-self-start rounded-md bg-gold-400 px-4 py-2 text-sm font-medium text-on-gold transition hover:bg-gold-300 disabled:opacity-50"
        >
          {pending ? "Saving…" : "Save profile"}
        </button>
        {saved && !pending ? (
          <span className="text-xs text-status-success">Saved.</span>
        ) : null}
      </div>
    </form>
  );
}

// --- Invite ---------------------------------------------------------------
function InviteForm({ seats }: { seats: SeatInfo }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);

  const unlimited = seats.limit === null;
  const full = !unlimited && seats.used >= (seats.limit ?? 0);
  const seatLabel = unlimited
    ? `${seats.used} seat${seats.used === 1 ? "" : "s"} used · unlimited`
    : `${seats.used} of ${seats.limit} seats used`;

  return (
    <form
      ref={formRef}
      action={(fd) => {
        setError(null);
        setSuccess(false);
        startTransition(async () => {
          const res = await inviteMember(fd);
          if (res.error) {
            setError(res.error);
          } else {
            setSuccess(true);
            formRef.current?.reset();
          }
        });
      }}
      className="grid gap-3 rounded-xl border border-line bg-surface-1 p-4 sm:grid-cols-[1fr_auto_auto]"
    >
      <div className="sm:col-span-3 flex flex-wrap items-baseline justify-between gap-x-3">
        <div>
          <p className="text-sm font-medium text-fg-primary">Invite member</p>
          <p className="mt-0.5 text-xs text-fg-muted">
            Enter your teammate&apos;s email. They&apos;ll need a FundExecs account —{" "}
            <a
              href="https://fundexecs.com"
              className="text-gold-300 underline hover:text-gold-300"
              target="_blank"
              rel="noopener noreferrer"
            >
              share fundexecs.com
            </a>{" "}
            so they can sign up first.
          </p>
        </div>
        <span
          className={`font-mono text-[11px] uppercase tracking-wider ${
            full ? "text-status-danger" : "text-fg-muted"
          }`}
        >
          {seatLabel}
        </span>
      </div>
      {full ? (
        <p className="sm:col-span-3 text-xs text-fg-secondary">
          Your plan’s seats are full.{" "}
          <a href="/wallet" className="text-gold-300 underline">
            Upgrade your plan
          </a>{" "}
          to add more members.
        </p>
      ) : null}
      <input
        name="email"
        type="email"
        required
        disabled={full}
        placeholder="name@firm.com"
        className={inputClass}
      />
      <select name="role" defaultValue="member" disabled={full} className={inputClass}>
        {ROLE_OPTIONS.map((r) => (
          <option key={r} value={r}>
            {r}
          </option>
        ))}
      </select>
      <button
        disabled={pending || full}
        className="rounded-md bg-gold-400 px-4 py-2 text-sm font-medium text-on-gold transition hover:bg-gold-300 disabled:opacity-50"
      >
        {pending ? "Adding…" : "Add"}
      </button>
      {error ? (
        <p className="text-xs text-status-danger sm:col-span-3">{error}</p>
      ) : null}
      {success ? (
        <p className="text-xs text-status-success sm:col-span-3">
          Member added.
        </p>
      ) : null}
    </form>
  );
}

// --- Admin member row -----------------------------------------------------
function AdminMemberRow({
  member,
  isSelf,
  canRemove,
  isLastOwner,
}: {
  member: TeamMemberView;
  isSelf: boolean;
  canRemove: boolean;
  isLastOwner: boolean;
}) {
  const [rolePending, startRole] = useTransition();
  const [removePending, startRemove] = useTransition();

  return (
    <div className="flex items-start gap-3 rounded-xl border border-line bg-surface-1 p-3">
      {/* Owners and admins may set any member's photo, so a teammate who has
          not logged in yet still has a face on the firm page. */}
      <AvatarUpload
        name={member.name}
        currentUrl={member.avatarUrl}
        principalId={member.principalId}
      />
      <div className="min-w-0">
        <p className="flex items-center gap-1.5 truncate text-sm text-fg-primary">
          <span className="truncate">{member.name}</span>
          {isSelf ? (
            <span className="font-mono text-[11px] uppercase tracking-wider text-gold-300">
              you
            </span>
          ) : null}
        </p>
        {member.title ? (
          <p className="truncate text-xs text-fg-secondary">{member.title}</p>
        ) : null}
        {member.email ? (
          <p className="truncate text-xs text-fg-muted">{member.email}</p>
        ) : null}
        {member.bio ? (
          <p className="mt-1 whitespace-pre-line text-xs leading-relaxed text-fg-secondary">
            {member.bio}
          </p>
        ) : null}
      </div>

      <div className="ml-auto flex shrink-0 items-center gap-2">
        <RoleBadge role={member.role} />
        <form
          action={(fd) => {
            fd.set("memberId", member.memberId);
            startRole(async () => {
              await changeMemberRole(fd);
            });
          }}
        >
          <select
            name="role"
            defaultValue={member.role}
            disabled={rolePending || isLastOwner}
            title={
              isLastOwner ? "The last owner's role cannot be changed." : undefined
            }
            onChange={(e) => e.currentTarget.form?.requestSubmit()}
            className="rounded-md border border-line bg-surface-0 px-2 py-1 font-mono text-[11px] uppercase tracking-wider text-fg-secondary focus:border-gold-500/60 focus:outline-none disabled:opacity-50"
          >
            {ROLE_OPTIONS.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        </form>

        {canRemove ? (
          <form
            action={(fd) => {
              fd.set("memberId", member.memberId);
              startRemove(async () => {
                await removeMember(fd);
              });
            }}
          >
            <button
              disabled={removePending}
              title="Remove member"
              className="rounded-md border border-line px-2 py-1 text-xs text-fg-muted transition hover:border-status-danger/40 hover:text-status-danger disabled:opacity-50"
            >
              ✕
            </button>
          </form>
        ) : (
          <span className="w-7" aria-hidden />
        )}
      </div>
    </div>
  );
}

// --- Read-only member row -------------------------------------------------
function ReadOnlyMemberRow({
  member,
  isSelf,
}: {
  member: TeamMemberView;
  isSelf: boolean;
}) {
  return (
    <div className="flex items-start gap-3 rounded-xl border border-line bg-surface-1 p-3">
      <Avatar name={member.name} avatarUrl={member.avatarUrl} />
      <div className="min-w-0">
        <p className="flex items-center gap-1.5 truncate text-sm text-fg-primary">
          <span className="truncate">{member.name}</span>
          {isSelf ? (
            <span className="font-mono text-[11px] uppercase tracking-wider text-gold-300">
              you
            </span>
          ) : null}
        </p>
        {member.title ? (
          <p className="truncate text-xs text-fg-secondary">{member.title}</p>
        ) : null}
        {member.email ? (
          <p className="truncate text-xs text-fg-muted">{member.email}</p>
        ) : null}
        {member.bio ? (
          <p className="mt-1 whitespace-pre-line text-xs leading-relaxed text-fg-secondary">
            {member.bio}
          </p>
        ) : null}
      </div>
      <span className="ml-auto shrink-0">
        <RoleBadge role={member.role} />
      </span>
    </div>
  );
}
