"use client";

import { useState } from "react";
import { saveUserProfile, changePassword } from "./actions";

const inputCls =
  "w-full rounded-lg border border-line bg-surface-0 px-3 py-2 text-sm text-fg-primary placeholder:text-fg-muted focus:border-gold-500/60 focus:outline-none focus:ring-1 focus:ring-gold-500/40 transition";

const labelCls = "font-mono text-[10px] uppercase tracking-wider text-fg-muted";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className={labelCls}>{label}</span>
      {children}
    </div>
  );
}

export function UserProfileForm({
  email,
  initialValues,
}: {
  email: string;
  initialValues: {
    full_name: string;
    title: string;
    phone: string;
    avatar_url: string;
  };
}) {
  const [profile, setProfile] = useState(initialValues);
  const [profileStatus, setProfileStatus] = useState<{ error?: string; ok?: boolean } | null>(null);
  const [profilePending, setProfilePending] = useState(false);

  const [passwords, setPasswords] = useState({ password: "", confirm: "" });
  const [pwStatus, setPwStatus] = useState<{ error?: string; ok?: boolean } | null>(null);
  const [pwPending, setPwPending] = useState(false);

  const handleProfileSave = async () => {
    setProfilePending(true);
    setProfileStatus(null);
    const fd = new FormData();
    fd.append("full_name", profile.full_name);
    fd.append("title", profile.title);
    fd.append("phone", profile.phone);
    fd.append("avatar_url", profile.avatar_url);
    const result = await saveUserProfile(fd);
    setProfileStatus(result?.error ? { error: result.error } : { ok: true });
    setProfilePending(false);
  };

  const handlePasswordChange = async () => {
    setPwPending(true);
    setPwStatus(null);
    const fd = new FormData();
    fd.append("password", passwords.password);
    fd.append("confirm", passwords.confirm);
    const result = await changePassword(fd);
    if (result?.error) {
      setPwStatus({ error: result.error });
    } else {
      setPwStatus({ ok: true });
      setPasswords({ password: "", confirm: "" });
    }
    setPwPending(false);
  };

  return (
    <div className="flex flex-col gap-6">
      {/* Personal info */}
      <div className="fx-card p-4 flex flex-col gap-4">
        <p className="font-mono text-[10px] uppercase tracking-widest text-fg-muted">Personal info</p>
        <Field label="Email">
          <p className="rounded-lg border border-line bg-surface-1 px-3 py-2 text-sm text-fg-secondary opacity-70">
            {email}
          </p>
        </Field>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Full name">
            <input
              className={inputCls}
              value={profile.full_name}
              onChange={(e) => setProfile((p) => ({ ...p, full_name: e.target.value }))}
              placeholder="Jordan Smith"
            />
          </Field>
          <Field label="Title">
            <input
              className={inputCls}
              value={profile.title}
              onChange={(e) => setProfile((p) => ({ ...p, title: e.target.value }))}
              placeholder="Managing Partner"
            />
          </Field>
          <Field label="Phone">
            <input
              type="tel"
              className={inputCls}
              value={profile.phone}
              onChange={(e) => setProfile((p) => ({ ...p, phone: e.target.value }))}
              placeholder="+1 (555) 000-0000"
            />
          </Field>
          <Field label="Profile photo URL">
            <input
              type="url"
              className={inputCls}
              value={profile.avatar_url}
              onChange={(e) => setProfile((p) => ({ ...p, avatar_url: e.target.value }))}
              placeholder="https://…"
            />
          </Field>
        </div>
        {profileStatus?.error && (
          <p className="rounded-md border border-red-500/20 bg-red-500/10 px-3 py-2 text-xs text-red-400">
            {profileStatus.error}
          </p>
        )}
        {profileStatus?.ok && (
          <p className="rounded-md border border-green-500/20 bg-green-500/10 px-3 py-2 text-xs text-green-400">
            Profile saved.
          </p>
        )}
        <div>
          <button
            type="button"
            onClick={handleProfileSave}
            disabled={profilePending}
            className="rounded-lg border border-gold-500/50 bg-gold-500/10 px-4 py-1.5 text-xs font-medium text-gold-300 transition hover:bg-gold-500/20 disabled:opacity-40"
          >
            {profilePending ? "Saving…" : "Save profile"}
          </button>
        </div>
      </div>

      {/* Password change */}
      <div className="fx-card p-4 flex flex-col gap-4">
        <p className="font-mono text-[10px] uppercase tracking-widest text-fg-muted">Change password</p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="New password">
            <input
              type="password"
              className={inputCls}
              value={passwords.password}
              onChange={(e) => setPasswords((p) => ({ ...p, password: e.target.value }))}
              placeholder="Min. 8 characters"
              autoComplete="new-password"
            />
          </Field>
          <Field label="Confirm password">
            <input
              type="password"
              className={inputCls}
              value={passwords.confirm}
              onChange={(e) => setPasswords((p) => ({ ...p, confirm: e.target.value }))}
              placeholder="Repeat new password"
              autoComplete="new-password"
            />
          </Field>
        </div>
        {pwStatus?.error && (
          <p className="rounded-md border border-red-500/20 bg-red-500/10 px-3 py-2 text-xs text-red-400">
            {pwStatus.error}
          </p>
        )}
        {pwStatus?.ok && (
          <p className="rounded-md border border-green-500/20 bg-green-500/10 px-3 py-2 text-xs text-green-400">
            Password updated.
          </p>
        )}
        <div>
          <button
            type="button"
            onClick={handlePasswordChange}
            disabled={pwPending || !passwords.password}
            className="rounded-lg border border-line px-4 py-1.5 text-xs font-medium text-fg-secondary transition hover:border-gold-500/40 hover:text-fg-primary disabled:opacity-40"
          >
            {pwPending ? "Updating…" : "Update password"}
          </button>
        </div>
      </div>
    </div>
  );
}
