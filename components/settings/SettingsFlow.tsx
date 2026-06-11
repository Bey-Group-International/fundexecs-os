'use client';

import { useActionState, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import {
  Building2,
  Check,
  CheckCircle2,
  Copy,
  KeyRound,
  Link2,
  Loader2,
  LogOut,
  RefreshCw,
  Settings,
  ShieldAlert,
  TriangleAlert,
  Upload,
  UserRound,
  UserPlus,
  X
} from 'lucide-react';
import { Avatar } from '@/components/ui/Avatar';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { SegTabs } from '@/components/ui/Tabs';
import { setAccountPassword } from '@/lib/actions/account-security';
import {
  deleteOrganization,
  inviteOrgMember,
  leaveWorkspace,
  removeOrgMember,
  transferOwnership,
  updateOrgLogo,
  updateOrgProfile,
  type OrgActionState
} from '@/lib/actions/organization';
import { updateAccountProfile, updateAvatar, type ProfileActionState } from '@/lib/actions/profile';
import {
  groupConnections,
  PROVIDER_META,
  syncedLabel,
  type IntegrationView,
  type Provider
} from '@/lib/integrations/catalog';
import { SYNC_FREQUENCY_OPTIONS, DEFAULT_SYNC_FREQUENCY } from '@/lib/integrations/sync-frequency';
import type { OAuthBanner, SettingsTabId } from '@/lib/settings/vocabulary';
import { SETTINGS_TABS } from '@/lib/settings/vocabulary';
import type { AccountProfile, WorkspaceProfile } from '@/lib/queries/settings';
import type { OrgTeam } from '@/lib/queries/org-members';
import { cn } from '@/lib/utils';

/* ============================================================================
 * SettingsFlow — the last "Soon" in the shell, gone. Three sections over the
 * preserved backend:
 *   Account      → profiles row (name / role / photo) + a real password
 *   Workspace    → organizations row, team + invites, danger zone (RLS-gated)
 *   Integrations → the full provider catalog over integration_connections
 * Every write is a real server action or API route; nothing is decorative.
 * ========================================================================= */

export interface SettingsFlowProps {
  initialTab: SettingsTabId;
  viewerUserId: string;
  account: AccountProfile;
  workspace: WorkspaceProfile | null;
  team: OrgTeam;
  integrations: IntegrationView[];
  banner: OAuthBanner;
}

const IDLE: OrgActionState = { status: 'idle', message: '' };
const IDLE_PROFILE: ProfileActionState = { status: 'idle', message: '' };

const ORG_TYPE_OPTIONS = [
  { value: 'fund', label: 'Fund manager' },
  { value: 'lp', label: 'Limited partner' },
  { value: 'operator', label: 'Operator' },
  { value: 'capital_provider', label: 'Capital provider' },
  { value: 'service_provider', label: 'Service provider' },
  { value: 'partner', label: 'Partner' }
];

/** Inline result line under a form — success in green, failure in red. */
function ActionNote({ state }: { state: { status: string; message: string } }) {
  if (state.status === 'idle' || !state.message) return null;
  const isError = state.status === 'error';
  return (
    <p
      role={isError ? 'alert' : 'status'}
      className={cn(
        'flex items-center gap-1.5 text-[12px]',
        isError ? 'text-danger' : 'text-success'
      )}
    >
      {isError ? <TriangleAlert size={13} aria-hidden /> : <CheckCircle2 size={13} aria-hidden />}
      {state.message}
    </p>
  );
}

function SectionHeader({
  icon: Icon,
  title,
  blurb
}: {
  icon: typeof Settings;
  title: string;
  blurb: string;
}) {
  return (
    <div className="flex items-center gap-3">
      <span className="flex h-9 w-9 flex-none items-center justify-center rounded-[10px] border border-[var(--accent-line)] bg-[var(--accent-soft)] text-[var(--accent)]">
        <Icon size={17} strokeWidth={1.9} aria-hidden />
      </span>
      <div className="min-w-0">
        <h2 className="text-[15px] font-semibold text-fg-1">{title}</h2>
        <p className="text-[12px] text-fg-4">{blurb}</p>
      </div>
    </div>
  );
}

export function SettingsFlow({
  initialTab,
  viewerUserId,
  account,
  workspace,
  team,
  integrations,
  banner
}: SettingsFlowProps) {
  const router = useRouter();
  const [tab, setTab] = useState<SettingsTabId>(initialTab);

  function changeTab(id: string) {
    setTab(id as SettingsTabId);
    router.replace(`/settings?tab=${id}`, { scroll: false });
  }

  return (
    <div className="flex flex-col gap-4">
      <Card className="flex flex-wrap items-center gap-3 p-5">
        <span className="flex h-11 w-11 flex-none items-center justify-center rounded-[12px] border border-[var(--accent-line)] bg-[var(--accent-soft)] text-[var(--accent)]">
          <Settings size={22} strokeWidth={1.9} aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <h1 className="text-[19px] font-semibold tracking-[-0.015em] text-fg-1">Settings</h1>
          <p className="mt-0.5 text-[12.5px] text-fg-3">
            Your account, your workspace, and the systems Earn works through.
          </p>
        </div>
        <SegTabs
          tabs={SETTINGS_TABS.map((t) => ({ id: t.id, label: t.label }))}
          active={tab}
          onChange={changeTab}
        />
      </Card>

      {tab === 'account' && <AccountSection account={account} />}
      {tab === 'workspace' && (
        <WorkspaceSection workspace={workspace} team={team} viewerUserId={viewerUserId} />
      )}
      {tab === 'integrations' && <IntegrationsSection views={integrations} banner={banner} />}
    </div>
  );
}

/* ── Account ──────────────────────────────────────────────────────────── */

function AccountSection({ account }: { account: AccountProfile }) {
  const [profileState, profileAction, profilePending] = useActionState(
    updateAccountProfile,
    IDLE_PROFILE
  );
  const [avatarState, avatarAction, avatarPending] = useActionState(updateAvatar, IDLE_PROFILE);

  const [password, setPassword] = useState('');
  const [pwState, setPwState] = useState<{ status: string; message: string }>(IDLE);
  const [pwPending, startPw] = useTransition();

  function savePassword() {
    startPw(async () => {
      const res = await setAccountPassword(password);
      if (res.ok) {
        setPassword('');
        setPwState({ status: 'success', message: 'Password set — it now works at sign-in.' });
      } else {
        setPwState({ status: 'error', message: res.error });
      }
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <Card className="flex flex-col gap-4 p-5">
        <SectionHeader
          icon={UserRound}
          title="Profile"
          blurb="How you appear across the workspace — the rail, approvals, and the record."
        />
        <div className="flex items-center gap-4">
          <Avatar name={account.name || 'You'} src={account.avatarUrl} size={56} tone="azure" />
          <form action={avatarAction} className="flex flex-col gap-1">
            <label className="inline-flex w-fit cursor-pointer items-center gap-1.5 rounded-xl border border-hairline bg-surface-2 px-3 py-1.5 text-[12.5px] font-medium text-fg-1 transition hover:bg-surface-3">
              {avatarPending ? (
                <Loader2 size={14} className="motion-safe:animate-spin" aria-hidden />
              ) : (
                <Upload size={14} aria-hidden />
              )}
              {avatarPending ? 'Uploading…' : 'Upload photo'}
              <input
                type="file"
                name="avatar"
                accept="image/*"
                className="sr-only"
                disabled={avatarPending}
                onChange={(e) => e.currentTarget.form?.requestSubmit()}
              />
            </label>
            <span className="text-[11px] text-fg-5">PNG or JPG, up to 5 MB.</span>
            <ActionNote state={avatarState} />
          </form>
        </div>
        <form action={profileAction} className="flex flex-col gap-3.5">
          <div className="grid gap-3.5 sm:grid-cols-2">
            <Input
              name="fullName"
              label="Full name"
              defaultValue={account.name}
              placeholder="Your name"
              required
              maxLength={120}
            />
            <Input
              name="role"
              label="Role"
              defaultValue={account.role}
              placeholder="e.g. Managing Partner"
              maxLength={80}
            />
          </div>
          <Input label="Email" value={account.email ?? ''} disabled hint="Sign-in email — fixed." />
          <div className="flex items-center gap-3">
            <Button type="submit" size="sm" disabled={profilePending}>
              {profilePending ? 'Saving…' : 'Save profile'}
            </Button>
            <ActionNote state={profileState} />
          </div>
        </form>
      </Card>

      <Card className="flex flex-col gap-4 p-5">
        <SectionHeader
          icon={KeyRound}
          title="Password"
          blurb="A durable way back in — works alongside Google sign-in and magic links."
        />
        <div className="flex flex-col gap-3.5 sm:max-w-sm">
          <Input
            type="password"
            label="New password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="At least 8 characters"
            minLength={8}
            autoComplete="new-password"
          />
          <div className="flex items-center gap-3">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              disabled={pwPending || password.length < 8}
              onClick={savePassword}
            >
              {pwPending ? 'Saving…' : 'Set password'}
            </Button>
            <ActionNote state={pwState} />
          </div>
        </div>
      </Card>
    </div>
  );
}

/* ── Workspace ────────────────────────────────────────────────────────── */

function WorkspaceSection({
  workspace,
  team,
  viewerUserId
}: {
  workspace: WorkspaceProfile | null;
  team: OrgTeam;
  viewerUserId: string;
}) {
  const canManage = team.viewerRole === 'owner' || team.viewerRole === 'admin';
  const isOwner = team.viewerRole === 'owner';

  const [orgState, orgAction, orgPending] = useActionState(updateOrgProfile, IDLE);
  const [logoState, logoAction, logoPending] = useActionState(updateOrgLogo, IDLE);
  const [inviteState, inviteAction, invitePending] = useActionState(inviteOrgMember, IDLE);
  const [transferState, transferAction, transferPending] = useActionState(transferOwnership, IDLE);
  const [deleteState, deleteAction, deletePending] = useActionState(deleteOrganization, IDLE);

  const [memberState, setMemberState] = useState<{ status: string; message: string }>(IDLE);
  const [memberPending, startMember] = useTransition();
  const [copied, setCopied] = useState(false);

  if (!workspace) {
    return (
      <Card className="p-8 text-center">
        <Building2 size={22} className="mx-auto text-fg-4" aria-hidden />
        <h2 className="mt-3 text-[15px] font-semibold text-fg-1">No workspace yet</h2>
        <p className="mx-auto mt-1.5 max-w-md text-[12.5px] leading-relaxed text-fg-4">
          Create or join a workspace from onboarding and its settings will live here.
        </p>
      </Card>
    );
  }

  function removeMember(memberId: string, name: string) {
    startMember(async () => {
      const res = await removeOrgMember(memberId);
      setMemberState(
        res.status === 'success' ? { status: 'success', message: `${name} removed.` } : res
      );
    });
  }

  function leave() {
    startMember(async () => {
      const res = await leaveWorkspace();
      setMemberState(res);
    });
  }

  async function copyInviteLink(link: string) {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }

  const otherActiveMembers = team.members.filter(
    (m) => m.userId !== viewerUserId && m.status === 'active'
  );

  return (
    <div className="flex flex-col gap-4">
      <Card className="flex flex-col gap-4 p-5">
        <SectionHeader
          icon={Building2}
          title="Organization"
          blurb={
            canManage
              ? 'The firm identity every surface renders.'
              : 'The firm identity — only owners and admins can edit it.'
          }
        />
        <div className="flex items-center gap-4">
          <Avatar name={workspace.name} src={workspace.logoUrl} size={56} tone="gold" />
          {canManage && (
            <form action={logoAction} className="flex flex-col gap-1">
              <label className="inline-flex w-fit cursor-pointer items-center gap-1.5 rounded-xl border border-hairline bg-surface-2 px-3 py-1.5 text-[12.5px] font-medium text-fg-1 transition hover:bg-surface-3">
                {logoPending ? (
                  <Loader2 size={14} className="motion-safe:animate-spin" aria-hidden />
                ) : (
                  <Upload size={14} aria-hidden />
                )}
                {logoPending ? 'Uploading…' : 'Upload logo'}
                <input
                  type="file"
                  name="logo"
                  accept="image/*"
                  className="sr-only"
                  disabled={logoPending}
                  onChange={(e) => e.currentTarget.form?.requestSubmit()}
                />
              </label>
              <span className="text-[11px] text-fg-5">PNG or JPG, up to 5 MB.</span>
              <ActionNote state={logoState} />
            </form>
          )}
        </div>
        <form action={orgAction} className="flex flex-col gap-3.5">
          <div className="grid gap-3.5 sm:grid-cols-2">
            <Input
              name="orgName"
              label="Organization name"
              defaultValue={workspace.name}
              required
              maxLength={120}
              disabled={!canManage}
            />
            <Select
              name="orgType"
              label="Type"
              options={ORG_TYPE_OPTIONS}
              defaultValue={workspace.type ?? 'fund'}
              disabled={!canManage}
            />
          </div>
          <Input
            name="description"
            label="Description"
            defaultValue={workspace.description ?? ''}
            placeholder="One line on what the firm does"
            maxLength={280}
            disabled={!canManage}
          />
          <Input
            name="website"
            label="Website"
            defaultValue={workspace.website ?? ''}
            placeholder="https://…"
            maxLength={200}
            disabled={!canManage}
          />
          {canManage && (
            <div className="flex items-center gap-3">
              <Button type="submit" size="sm" disabled={orgPending}>
                {orgPending ? 'Saving…' : 'Save organization'}
              </Button>
              <ActionNote state={orgState} />
            </div>
          )}
        </form>
      </Card>

      <Card className="flex flex-col gap-4 p-5">
        <SectionHeader
          icon={UserPlus}
          title="Team"
          blurb="Who works this desk — invites ride one-time magic links."
        />
        <div className="flex flex-col gap-2">
          {team.members.map((m) => (
            <div
              key={m.memberId}
              className="flex items-center gap-3 rounded-xl border border-hairline bg-surface-1 px-3 py-2.5"
            >
              <Avatar name={m.name} src={m.avatarUrl} size={32} tone="azure" />
              <div className="min-w-0 flex-1">
                <div className="truncate text-[13px] font-semibold text-fg-1">
                  {m.name}
                  {m.userId === viewerUserId && (
                    <span className="ml-1.5 text-[11px] font-normal text-fg-5">you</span>
                  )}
                </div>
              </div>
              <Badge tone={m.role === 'owner' ? 'gold' : m.role === 'admin' ? 'azure' : 'neutral'}>
                {m.role}
              </Badge>
              {canManage && m.role !== 'owner' && m.userId !== viewerUserId && (
                <button
                  type="button"
                  title={`Remove ${m.name}`}
                  aria-label={`Remove ${m.name}`}
                  disabled={memberPending}
                  onClick={() => removeMember(m.memberId, m.name)}
                  className="flex h-7 w-7 items-center justify-center rounded-lg border border-hairline text-fg-4 transition hover:bg-surface-2 hover:text-danger"
                >
                  <X size={13} aria-hidden />
                </button>
              )}
            </div>
          ))}
          {team.invites.map((i) => (
            <div
              key={i.id}
              className="flex items-center gap-3 rounded-xl border border-dashed border-hairline px-3 py-2.5"
            >
              <span className="flex h-8 w-8 flex-none items-center justify-center rounded-full border border-hairline bg-surface-2 text-fg-4">
                <UserPlus size={14} aria-hidden />
              </span>
              <div className="min-w-0 flex-1">
                <div className="truncate text-[13px] text-fg-2">{i.email}</div>
              </div>
              <Badge tone="warning">invited · {i.role}</Badge>
            </div>
          ))}
        </div>
        <ActionNote state={memberState} />
        {canManage && (
          <form action={inviteAction} className="flex flex-col gap-3 border-t border-hairline pt-4">
            <div className="grid gap-3 sm:grid-cols-[1fr_160px_auto] sm:items-end">
              <Input
                name="email"
                type="email"
                label="Invite a teammate"
                placeholder="name@firm.com"
                required
              />
              <Select
                name="role"
                label="Role"
                options={
                  isOwner
                    ? [
                        { value: 'member', label: 'Member' },
                        { value: 'admin', label: 'Admin' },
                        { value: 'owner', label: 'Owner' }
                      ]
                    : [
                        { value: 'member', label: 'Member' },
                        { value: 'admin', label: 'Admin' }
                      ]
                }
                defaultValue="member"
              />
              <Button type="submit" size="sm" icon={UserPlus} disabled={invitePending}>
                {invitePending ? 'Creating…' : 'Create invite'}
              </Button>
            </div>
            <ActionNote state={inviteState} />
            {inviteState.status === 'success' && inviteState.link && (
              <div className="flex items-center gap-2 rounded-xl border border-[var(--azure-line)] bg-[var(--azure-soft)] px-3 py-2.5">
                <Link2 size={14} className="flex-none text-azure-1" aria-hidden />
                <code className="min-w-0 flex-1 truncate text-[11.5px] text-fg-2">
                  {inviteState.link}
                </code>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  icon={copied ? Check : Copy}
                  onClick={() => void copyInviteLink(inviteState.link!)}
                >
                  {copied ? 'Copied' : 'Copy'}
                </Button>
              </div>
            )}
          </form>
        )}
      </Card>

      <Card className="flex flex-col gap-4 border-[var(--danger-line)] p-5">
        <SectionHeader
          icon={ShieldAlert}
          title="Danger zone"
          blurb="Ownership, leaving, and deletion — deliberate moves only."
        />
        {isOwner && otherActiveMembers.length > 0 && (
          <form
            action={transferAction}
            className="flex flex-col gap-3 sm:max-w-md"
            aria-label="Transfer ownership"
          >
            <div className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
              <Select
                name="newOwnerUserId"
                label="Transfer ownership to"
                options={otherActiveMembers.map((m) => ({ value: m.userId, label: m.name }))}
                placeholder="Choose a member"
                defaultValue=""
                required
              />
              <Button type="submit" variant="secondary" size="sm" disabled={transferPending}>
                {transferPending ? 'Transferring…' : 'Transfer'}
              </Button>
            </div>
            <ActionNote state={transferState} />
          </form>
        )}
        <div className="flex flex-col gap-2 border-t border-hairline pt-4">
          <div className="flex items-center gap-3">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              icon={LogOut}
              disabled={memberPending}
              onClick={leave}
            >
              Leave workspace
            </Button>
            <span className="text-[11.5px] text-fg-5">
              {isOwner ? 'Sole owners must transfer or delete first.' : 'You can be re-invited.'}
            </span>
          </div>
        </div>
        {isOwner && (
          <form
            action={deleteAction}
            className="flex flex-col gap-3 border-t border-hairline pt-4 sm:max-w-md"
            aria-label="Delete workspace"
          >
            <div className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
              <Input
                name="confirm"
                label="Delete this workspace permanently"
                placeholder="Type DELETE to confirm"
                autoComplete="off"
                required
              />
              <Button type="submit" variant="danger" size="sm" disabled={deletePending}>
                {deletePending ? 'Deleting…' : 'Delete workspace'}
              </Button>
            </div>
            <span className="text-[11.5px] text-fg-5">
              Removes the workspace and everything in it. There is no undo.
            </span>
            <ActionNote state={deleteState} />
          </form>
        )}
      </Card>
    </div>
  );
}

/* ── Integrations ─────────────────────────────────────────────────────── */

function IntegrationsSection({ views, banner }: { views: IntegrationView[]; banner: OAuthBanner }) {
  const router = useRouter();
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [requested, setRequested] = useState<Set<string>>(() => new Set());
  const [apolloKey, setApolloKey] = useState('');

  const groups = groupConnections(views);

  async function post(provider: string, url: string, body?: unknown): Promise<boolean> {
    setPending(provider);
    setError(null);
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: body ? { 'Content-Type': 'application/json' } : undefined,
        body: body ? JSON.stringify(body) : undefined
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { error?: string } | null;
        setError(data?.error ?? 'That didn’t go through — try again.');
        return false;
      }
      router.refresh();
      return true;
    } catch {
      setError('That didn’t go through — check your connection and try again.');
      return false;
    } finally {
      setPending(null);
    }
  }

  async function requestAccess(provider: Provider) {
    const ok = await post(provider, '/api/integrations/request-access', { provider });
    if (ok) setRequested((prev) => new Set(prev).add(provider));
  }

  return (
    <div className="flex flex-col gap-4">
      {banner && (
        <div
          role={banner.tone === 'danger' ? 'alert' : 'status'}
          className={cn(
            'flex items-center gap-2.5 rounded-xl border px-3.5 py-2.5 text-[12.5px]',
            banner.tone === 'danger'
              ? 'border-[var(--danger-line)] bg-[var(--danger-soft)] text-danger'
              : 'border-[var(--success-line)] bg-[var(--success-soft)] text-success'
          )}
        >
          {banner.tone === 'danger' ? (
            <TriangleAlert size={15} aria-hidden />
          ) : (
            <CheckCircle2 size={15} aria-hidden />
          )}
          {banner.message}
        </div>
      )}
      {error && (
        <div
          role="alert"
          className="flex items-center gap-2.5 rounded-xl border border-[var(--danger-line)] bg-[var(--danger-soft)] px-3.5 py-2.5 text-[12.5px] text-danger"
        >
          <TriangleAlert size={15} aria-hidden />
          {error}
        </div>
      )}

      {groups.map(({ group, items }) => (
        <Card key={group.id} className="flex flex-col gap-3 p-5">
          <div>
            <h2 className="text-[14px] font-semibold text-fg-1">{group.label}</h2>
            <p className="text-[12px] text-fg-4">{group.blurb}</p>
          </div>
          <div className="flex flex-col gap-2">
            {items.map((item) => {
              const meta = PROVIDER_META[item.provider];
              const Icon = meta.icon;
              const connected = item.status === 'connected';
              const isPending = pending === item.provider;
              const isRequested = item.requested || requested.has(item.provider);
              return (
                <div
                  key={item.provider}
                  className="flex flex-wrap items-center gap-3 rounded-xl border border-hairline bg-surface-1 px-3 py-2.5"
                >
                  <span className="flex h-9 w-9 flex-none items-center justify-center rounded-[10px] border border-hairline bg-surface-2 text-fg-2">
                    <Icon size={16} strokeWidth={1.9} aria-hidden />
                  </span>
                  <div className="min-w-0 flex-1 basis-48">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="text-[13px] font-semibold text-fg-1">{meta.name}</span>
                      <Badge tone="neutral" className="px-1.5 py-0 text-[9px]">
                        {meta.category}
                      </Badge>
                      {item.status === 'error' && <Badge tone="danger">needs attention</Badge>}
                    </div>
                    <p className="mt-0.5 truncate text-[11.5px] text-fg-4">
                      {connected
                        ? `${item.external_account ?? 'Connected'} · ${syncedLabel(item.last_synced_at)}`
                        : meta.description}
                    </p>
                  </div>
                  <div className="flex flex-none items-center gap-2">
                    {connected ? (
                      <>
                        <Select
                          aria-label={`${meta.name} sync cadence`}
                          options={SYNC_FREQUENCY_OPTIONS.map((o) => ({
                            value: o.value,
                            label: o.label
                          }))}
                          value={item.sync_frequency ?? DEFAULT_SYNC_FREQUENCY}
                          disabled={isPending}
                          onChange={(e) =>
                            void post(
                              item.provider,
                              `/api/integrations/${item.provider}/frequency`,
                              {
                                frequency: e.target.value
                              }
                            )
                          }
                          className="w-[130px] py-1.5 text-[12px]"
                        />
                        <Button
                          type="button"
                          variant="secondary"
                          size="sm"
                          icon={isPending ? Loader2 : RefreshCw}
                          disabled={isPending}
                          onClick={() =>
                            void post(item.provider, `/api/integrations/${item.provider}/sync`)
                          }
                        >
                          Sync now
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          disabled={isPending}
                          onClick={() =>
                            void post(
                              item.provider,
                              `/api/integrations/${item.provider}/disconnect`
                            )
                          }
                        >
                          Disconnect
                        </Button>
                      </>
                    ) : !item.available ? (
                      isRequested ? (
                        <Badge tone="azure">Requested</Badge>
                      ) : (
                        <Button
                          type="button"
                          variant="secondary"
                          size="sm"
                          disabled={isPending}
                          onClick={() => void requestAccess(item.provider)}
                        >
                          Request access
                        </Button>
                      )
                    ) : meta.connect === 'api_key' ? (
                      <div className="flex items-center gap-2">
                        <Input
                          type="password"
                          aria-label={`${meta.name} API key`}
                          placeholder="API key"
                          value={apolloKey}
                          onChange={(e) => setApolloKey(e.target.value)}
                          autoComplete="off"
                          className="w-[150px] py-1.5 text-[12px]"
                        />
                        <Button
                          type="button"
                          size="sm"
                          disabled={isPending || apolloKey.trim().length < 8}
                          onClick={async () => {
                            const ok = await post(
                              item.provider,
                              `/api/integrations/${item.provider}/connect`,
                              { apiKey: apolloKey.trim() }
                            );
                            if (ok) setApolloKey('');
                          }}
                        >
                          Connect
                        </Button>
                      </div>
                    ) : (
                      <Button
                        type="button"
                        size="sm"
                        onClick={() => {
                          window.location.href = `/api/integrations/${item.provider}/connect`;
                        }}
                      >
                        Connect
                      </Button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </Card>
      ))}
    </div>
  );
}
