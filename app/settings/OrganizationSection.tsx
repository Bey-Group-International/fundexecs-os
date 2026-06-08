'use client';

import { useActionState, useRef, useState, useTransition } from 'react';
import { useFormStatus } from 'react-dom';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  Building2,
  Check,
  Copy,
  CreditCard,
  Globe,
  Loader2,
  Trash2,
  UploadCloud,
  UserPlus,
  Users
} from 'lucide-react';
import { Avatar, Badge, Card, Input, Select, SectionTitle } from '@/components/ui';
import { cn } from '@/lib/utils';
import type { Database } from '@/lib/supabase/database.types';
import type { OrgSubscription } from '@/lib/queries/subscription';
import type { OrgTeam, OrgTeamMember, OrgMemberRole } from '@/lib/queries/org-members';
import {
  updateOrgProfile,
  updateOrgLogo,
  inviteOrgMember,
  removeOrgMember,
  transferOwnership,
  leaveWorkspace,
  deleteOrganization,
  type OrgActionState
} from '@/lib/actions/organization';
import { setMemberRole } from '@/lib/actions/admin';

type OrgType = Database['public']['Enums']['org_type'];

const ORG_OPTIONS: Array<{ value: OrgType; label: string }> = [
  { value: 'fund', label: 'Fund' },
  { value: 'lp', label: 'Limited partner' },
  { value: 'operator', label: 'Operator' },
  { value: 'capital_provider', label: 'Capital provider' },
  { value: 'service_provider', label: 'Service provider' },
  { value: 'partner', label: 'Partner' }
];

const ROLE_OPTIONS: Array<{ value: OrgMemberRole; label: string }> = [
  { value: 'owner', label: 'Owner' },
  { value: 'admin', label: 'Admin' },
  { value: 'member', label: 'Member' }
];

const INITIAL: OrgActionState = { status: 'idle', message: '' };

export interface OrganizationSectionProps {
  currentUserId: string;
  orgName: string | null;
  orgType: OrgType | null;
  orgTier: string | null;
  orgDescription: string | null;
  orgWebsite: string | null;
  orgLogoUrl: string | null;
  team: OrgTeam;
  subscription: OrgSubscription;
}

export function OrganizationSection(props: OrganizationSectionProps) {
  const { team } = props;
  const isManager = team.viewerRole === 'owner' || team.viewerRole === 'admin';
  const isOwner = team.viewerRole === 'owner';

  return (
    <div className="flex flex-col gap-[18px]">
      <IdentityCard {...props} canEdit={isManager} />
      <TeamCard {...props} canManage={isManager} isOwner={isOwner} />
      <PlanCard subscription={props.subscription} />
      {isOwner ? <DangerZone {...props} /> : <LeaveCard />}
    </div>
  );
}

/* ---------------------------------------------------------------------------
 * Shared bits
 * ------------------------------------------------------------------------- */

function SubmitButton({ label, icon: Icon }: { label: string; icon?: typeof Check }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="inline-flex items-center gap-1.5 rounded-xl bg-[var(--cta-gradient)] px-3.5 py-2 text-[12.5px] font-semibold text-white shadow-[var(--shadow-cta)] transition hover:brightness-110 disabled:opacity-60"
    >
      {pending ? (
        <Loader2 size={13} strokeWidth={2.2} className="animate-spin" aria-hidden />
      ) : Icon ? (
        <Icon size={13} strokeWidth={2.2} aria-hidden />
      ) : null}
      {label}
    </button>
  );
}

function Notice({ state }: { state: OrgActionState }) {
  if (state.status === 'idle' || !state.message) return null;
  return (
    <p
      role={state.status === 'error' ? 'alert' : 'status'}
      className={cn('text-[12px]', state.status === 'error' ? 'text-danger' : 'text-success')}
    >
      {state.message}
    </p>
  );
}

/* ---------------------------------------------------------------------------
 * 1) Identity — logo + name/type/description/website
 * ------------------------------------------------------------------------- */

function IdentityCard({
  orgName,
  orgType,
  orgTier,
  orgDescription,
  orgWebsite,
  orgLogoUrl,
  canEdit
}: OrganizationSectionProps & { canEdit: boolean }) {
  const [state, formAction] = useActionState(updateOrgProfile, INITIAL);
  const [logoState, logoAction] = useActionState(updateOrgLogo, INITIAL);
  const logoInputRef = useRef<HTMLInputElement | null>(null);
  const logoFormRef = useRef<HTMLFormElement | null>(null);

  return (
    <Card>
      <SectionTitle eyebrow="Organization" title="Workspace identity" />
      <div className="mt-4 flex flex-col gap-4">
        {/* Logo + tier row */}
        <div className="flex items-center gap-4">
          <Avatar name={orgName ?? 'Workspace'} src={orgLogoUrl} size={56} tone="gold" />
          <div className="min-w-0 flex-1">
            <div className="text-[13.5px] font-semibold text-fg-1">
              {orgName ?? 'Your workspace'}
            </div>
            <div className="mt-0.5 flex items-center gap-2">
              <Badge tone="info" className="text-[10.5px]">
                {orgTier ?? 'Emerging manager'}
              </Badge>
              {canEdit ? (
                <form action={logoAction} ref={logoFormRef}>
                  <input
                    ref={logoInputRef}
                    type="file"
                    name="logo"
                    accept="image/*"
                    className="hidden"
                    onChange={() => logoFormRef.current?.requestSubmit()}
                  />
                  <button
                    type="button"
                    onClick={() => logoInputRef.current?.click()}
                    className="inline-flex items-center gap-1 text-[11.5px] font-semibold text-azure-1 hover:underline"
                  >
                    <UploadCloud size={12} strokeWidth={2} aria-hidden />
                    Change logo
                  </button>
                </form>
              ) : null}
            </div>
          </div>
        </div>
        <Notice state={logoState} />

        {canEdit ? (
          <form action={formAction} className="flex flex-col gap-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Input
                label="Organization name"
                name="orgName"
                icon={Building2}
                defaultValue={orgName ?? ''}
                placeholder="Your organization"
                required
                maxLength={120}
              />
              <Select
                label="Organization type"
                name="orgType"
                defaultValue={orgType ?? 'fund'}
                options={ORG_OPTIONS}
              />
            </div>
            <Input
              label="Website"
              name="website"
              icon={Globe}
              defaultValue={orgWebsite ?? ''}
              placeholder="https://…"
              maxLength={200}
            />
            <label className="flex flex-col gap-1.5">
              <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-fg-4">
                Short description
              </span>
              <textarea
                name="description"
                defaultValue={orgDescription ?? ''}
                maxLength={280}
                rows={3}
                placeholder="One or two lines a counterparty should read first."
                className="w-full resize-y rounded-xl border border-hairline bg-surface-2 px-3 py-2.5 text-[13px] leading-relaxed text-fg-1 outline-none transition placeholder:text-fg-4 focus:border-[var(--accent-line)] focus:shadow-[0_0_0_3px_var(--accent-soft)]"
              />
            </label>
            <div className="flex items-center justify-between gap-3">
              <Notice state={state} />
              <div className="ml-auto">
                <SubmitButton label="Save details" icon={Check} />
              </div>
            </div>
          </form>
        ) : (
          <p className="text-[12px] text-fg-4">
            Only workspace owners and admins can edit these details.
          </p>
        )}
      </div>
    </Card>
  );
}

/* ---------------------------------------------------------------------------
 * 2) Team — members + invite
 * ------------------------------------------------------------------------- */

function TeamCard({
  team,
  currentUserId,
  canManage,
  isOwner
}: OrganizationSectionProps & { canManage: boolean; isOwner: boolean }) {
  const [inviteState, inviteAction] = useActionState(inviteOrgMember, INITIAL);
  const [copied, setCopied] = useState(false);

  function copyLink() {
    if (!inviteState.link) return;
    void navigator.clipboard?.writeText?.(inviteState.link)?.then(
      () => {
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1800);
      },
      () => setCopied(false)
    );
  }

  return (
    <Card>
      <SectionTitle
        eyebrow="Team"
        title="Members & roles"
        action={
          <span className="inline-flex items-center gap-1.5 text-[11px] text-fg-4">
            <Users size={12} strokeWidth={2} aria-hidden />
            {team.members.length} {team.members.length === 1 ? 'member' : 'members'}
          </span>
        }
      />

      <ul className="mt-4 flex flex-col gap-1.5">
        {team.members.map((m) => (
          <MemberRow
            key={m.memberId}
            member={m}
            canManage={canManage}
            isOwner={isOwner}
            isSelf={m.userId === currentUserId}
          />
        ))}
      </ul>

      {/* Pending invites */}
      {team.invites.length > 0 ? (
        <div className="mt-3">
          <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-fg-4">
            Pending invites
          </p>
          <ul className="flex flex-col gap-1.5">
            {team.invites.map((inv) => (
              <li
                key={inv.id}
                className="flex items-center justify-between gap-3 rounded-xl border border-dashed border-hairline bg-surface-1 px-3 py-2"
              >
                <span className="truncate text-[12.5px] text-fg-2">{inv.email}</span>
                <Badge tone="warning" className="text-[10px] capitalize">
                  {inv.role}
                </Badge>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {/* Invite form */}
      {canManage ? (
        <form
          action={inviteAction}
          className="mt-4 flex flex-col gap-2 border-t border-hairline pt-4"
        >
          <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-fg-4">
            Invite a teammate
          </p>
          <div className="flex flex-col gap-2 sm:flex-row">
            <div className="flex-1">
              <Input
                name="email"
                type="email"
                placeholder="teammate@firm.com"
                required
                maxLength={200}
              />
            </div>
            <Select
              name="role"
              defaultValue="member"
              options={isOwner ? ROLE_OPTIONS : ROLE_OPTIONS.filter((r) => r.value !== 'owner')}
            />
            <SubmitButton label="Invite" icon={UserPlus} />
          </div>
          <Notice state={inviteState} />
          {inviteState.link ? (
            <div className="flex items-center gap-2 rounded-xl border border-hairline bg-surface-1 px-3 py-2">
              <span className="min-w-0 flex-1 truncate text-[11.5px] text-fg-3">
                {inviteState.link}
              </span>
              <button
                type="button"
                onClick={copyLink}
                className="inline-flex flex-none items-center gap-1 text-[11.5px] font-semibold text-azure-1 hover:underline"
              >
                {copied ? (
                  <Check size={12} strokeWidth={2.2} aria-hidden />
                ) : (
                  <Copy size={12} strokeWidth={2} aria-hidden />
                )}
                {copied ? 'Copied' : 'Copy link'}
              </button>
            </div>
          ) : null}
        </form>
      ) : null}
    </Card>
  );
}

function MemberRow({
  member,
  canManage,
  isOwner,
  isSelf
}: {
  member: OrgTeamMember;
  canManage: boolean;
  isOwner: boolean;
  isSelf: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function changeRole(role: OrgMemberRole) {
    setError(null);
    startTransition(async () => {
      const res = await setMemberRole(member.memberId, role);
      if (res.ok) router.refresh();
      else setError(res.error);
    });
  }

  function remove() {
    setError(null);
    startTransition(async () => {
      const res = await removeOrgMember(member.memberId);
      if (res.status === 'success') router.refresh();
      else setError(res.message);
    });
  }

  // Only an owner can change/remove another owner; admins can't touch owners.
  const lockedByRank = member.role === 'owner' && !isOwner;
  const canEditRow = canManage && !isSelf && !lockedByRank;

  return (
    <li className="flex items-center gap-3 rounded-xl border border-hairline bg-bg-1 px-3 py-2">
      <Avatar name={member.name} src={member.avatarUrl} size={30} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-[12.5px] font-semibold text-fg-1">
          {member.name}
          {isSelf ? <span className="ml-1 text-[11px] font-normal text-fg-4">(you)</span> : null}
        </p>
        {error ? <p className="text-[11px] text-danger">{error}</p> : null}
      </div>
      {canEditRow ? (
        <>
          <select
            aria-label={`Role for ${member.name}`}
            value={member.role}
            disabled={pending}
            onChange={(e) => changeRole(e.target.value as OrgMemberRole)}
            className="rounded-lg border border-hairline bg-surface-1 px-2 py-1 text-[11.5px] font-medium text-fg-1 outline-none focus:border-[var(--accent-line)] disabled:opacity-60"
          >
            {(isOwner ? ROLE_OPTIONS : ROLE_OPTIONS.filter((r) => r.value !== 'owner')).map((r) => (
              <option key={r.value} value={r.value}>
                {r.label}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={remove}
            disabled={pending}
            aria-label={`Remove ${member.name}`}
            className="flex h-7 w-7 flex-none items-center justify-center rounded-lg border border-hairline text-fg-4 transition hover:bg-[var(--danger-soft)] hover:text-danger disabled:opacity-60"
          >
            <Trash2 size={13} strokeWidth={2} aria-hidden />
          </button>
        </>
      ) : (
        <Badge
          tone={member.role === 'owner' ? 'gold' : 'neutral'}
          className="text-[10px] capitalize"
        >
          {member.role}
        </Badge>
      )}
    </li>
  );
}

/* ---------------------------------------------------------------------------
 * 3) Plan & seats — read-only summary
 * ------------------------------------------------------------------------- */

function PlanCard({ subscription }: { subscription: OrgSubscription }) {
  return (
    <Card>
      <SectionTitle
        eyebrow="Billing"
        title="Plan & seats"
        action={
          <Link
            href="/settings#billing"
            className="text-[11.5px] font-semibold text-azure-1 hover:underline"
          >
            Manage
          </Link>
        }
      />
      <div className="mt-4 grid grid-cols-2 gap-2.5 sm:grid-cols-3">
        <Stat
          label="Plan"
          value={subscription.configured ? capitalize(subscription.plan) : 'Free'}
        />
        <Stat label="Seats" value={String(subscription.seats)} />
        <Stat label="Status" value={capitalize(subscription.status)} />
      </div>
      <p className="mt-3 inline-flex items-center gap-1.5 text-[11.5px] text-fg-4">
        <CreditCard size={12} strokeWidth={2} aria-hidden />
        {subscription.creditsPerPeriod > 0
          ? `${subscription.creditsPerPeriod.toLocaleString()} credits / period`
          : 'Credits applied per billing period'}
      </p>
    </Card>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-hairline bg-surface-1 px-3 py-2.5">
      <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-fg-4">{label}</div>
      <div className="mt-0.5 text-[14px] font-semibold text-fg-1">{value}</div>
    </div>
  );
}

function capitalize(s: string): string {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

/* ---------------------------------------------------------------------------
 * 4) Danger zone — transfer / leave / delete (owner)
 * ------------------------------------------------------------------------- */

function DangerZone(props: OrganizationSectionProps) {
  const { team, currentUserId } = props;
  const [transferState, transferAction] = useActionState(transferOwnership, INITIAL);
  const [deleteState, deleteAction] = useActionState(deleteOrganization, INITIAL);
  const transferTargets = team.members.filter(
    (m) => m.userId !== currentUserId && m.status === 'active'
  );

  return (
    <Card className="border-[var(--danger-line)]">
      <SectionTitle eyebrow="Danger zone" title="Ownership & deletion" />
      <div className="mt-4 flex flex-col gap-4">
        {/* Transfer ownership */}
        <form
          action={transferAction}
          className="flex flex-col gap-2 rounded-xl border border-hairline bg-surface-1 p-3"
        >
          <div className="text-[12.5px] font-semibold text-fg-1">Transfer ownership</div>
          <p className="text-[11.5px] text-fg-4">
            Hand the workspace to another member. You become an admin.
          </p>
          {transferTargets.length > 0 ? (
            <div className="flex flex-col gap-2 sm:flex-row">
              <Select
                name="newOwnerUserId"
                defaultValue=""
                options={[
                  { value: '', label: 'Choose a member…' },
                  ...transferTargets.map((m) => ({ value: m.userId, label: m.name }))
                ]}
              />
              <SubmitButton label="Transfer" />
            </div>
          ) : (
            <p className="text-[11.5px] text-fg-4">Invite another member first.</p>
          )}
          <Notice state={transferState} />
        </form>

        {/* Delete workspace */}
        <form
          action={deleteAction}
          className="flex flex-col gap-2 rounded-xl border border-[var(--danger-line)] bg-[var(--danger-soft)] p-3"
        >
          <div className="text-[12.5px] font-semibold text-danger">Delete workspace</div>
          <p className="text-[11.5px] text-fg-3">
            Permanently deletes this workspace and all its data. This cannot be undone. Type{' '}
            <span className="font-semibold">DELETE</span> to confirm.
          </p>
          <div className="flex flex-col gap-2 sm:flex-row">
            <div className="flex-1">
              <Input name="confirm" placeholder="DELETE" autoComplete="off" />
            </div>
            <button
              type="submit"
              className="inline-flex items-center gap-1.5 rounded-xl border border-[var(--danger-line)] bg-transparent px-3.5 py-2 text-[12.5px] font-semibold text-danger transition hover:bg-danger hover:text-white"
            >
              <Trash2 size={13} strokeWidth={2.2} aria-hidden />
              Delete
            </button>
          </div>
          <Notice state={deleteState} />
        </form>
      </div>
    </Card>
  );
}

/** For non-owners: just the leave action. */
function LeaveCard() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function leave() {
    setError(null);
    startTransition(async () => {
      const res = await leaveWorkspace();
      if (res.status === 'success') router.push('/');
      else setError(res.message);
    });
  }

  return (
    <Card className="border-[var(--danger-line)]">
      <SectionTitle eyebrow="Danger zone" title="Leave workspace" />
      <div className="mt-3 flex items-center justify-between gap-3">
        <p className="text-[11.5px] text-fg-4">Remove yourself from this workspace.</p>
        <button
          type="button"
          onClick={leave}
          disabled={pending}
          className="inline-flex items-center gap-1.5 rounded-xl border border-[var(--danger-line)] px-3.5 py-2 text-[12.5px] font-semibold text-danger transition hover:bg-danger hover:text-white disabled:opacity-60"
        >
          {pending ? (
            <Loader2 size={13} strokeWidth={2.2} className="animate-spin" aria-hidden />
          ) : null}
          Leave
        </button>
      </div>
      {error ? <p className="mt-2 text-[11px] text-danger">{error}</p> : null}
    </Card>
  );
}
