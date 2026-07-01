"use client";

import { useRef, useState } from "react";
import { saveUserProfile, changePassword } from "./actions";

const MAX_AVATAR_BYTES = 600 * 1024;

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

function estimateBytes(dataUrl: string): number {
  const i = dataUrl.indexOf(",");
  const b64 = i >= 0 ? dataUrl.slice(i + 1) : dataUrl;
  return Math.floor((b64.length * 3) / 4);
}

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
  const [avatarError, setAvatarError] = useState("");
  const [profileStatus, setProfileStatus] = useState<{ error?: string; ok?: boolean } | null>(null);
  const [profilePending, setProfilePending] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const [passwords, setPasswords] = useState({ password: "", confirm: "" });
  const [pwStatus, setPwStatus] = useState<{ error?: string; ok?: boolean } | null>(null);
  const [pwPending, setPwPending] = useState(false);

  async function onAvatarFile(file: File) {
    setAvatarError("");
    const url = URL.createObjectURL(file);
    try {
      const img = await loadImage(url);
      const longest = Math.max(img.width, img.height);
      const scale = longest > 512 ? 512 / longest : 1;
      const w = Math.max(1, Math.round(img.width * scale));
      const h = Math.max(1, Math.round(img.height * scale));
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        setAvatarError("Could not process this image. Try another file.");
        return;
      }
      ctx.drawImage(img, 0, 0, w, h);
      let dataUrl = canvas.toDataURL("image/webp", 0.85);
      if (!dataUrl.startsWith("data:image/webp")) {
        dataUrl = canvas.toDataURL("image/png");
      }
      if (estimateBytes(dataUrl) > MAX_AVATAR_BYTES) {
        setAvatarError("Image is too large after compression (>600KB). Try a smaller file.");
        return;
      }
      setProfile((p) => ({ ...p, avatar_url: dataUrl }));
    } catch {
      setAvatarError("Could not read that file. Make sure it's a valid JPG or PNG.");
    } finally {
      URL.revokeObjectURL(url);
    }
  }

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
          <Field label="Profile photo">
            <div className="flex items-center gap-3">
              {profile.avatar_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={profile.avatar_url}
                  alt="Profile photo preview"
                  className="h-10 w-10 rounded-full object-cover border border-line shrink-0"
                />
              ) : (
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-dashed border-line bg-surface-1 font-mono text-xs text-fg-muted">
                  ?
                </span>
              )}
              <div className="flex flex-col gap-1 min-w-0">
                <button
                  type="button"
                  onClick={() => fileRef.current?.click()}
                  className="rounded-md border border-line px-2.5 py-1 text-xs text-fg-secondary transition hover:border-gold-500/40 hover:text-fg-primary"
                >
                  {profile.avatar_url ? "Change photo" : "Upload photo"}
                </button>
                {profile.avatar_url && (
                  <button
                    type="button"
                    onClick={() => {
                      setProfile((p) => ({ ...p, avatar_url: "" }));
                      setAvatarError("");
                      if (fileRef.current) fileRef.current.value = "";
                    }}
                    className="text-left text-[11px] text-fg-muted transition hover:text-status-danger"
                  >
                    Remove
                  </button>
                )}
              </div>
              <input
                ref={fileRef}
                type="file"
                accept="image/jpeg,image/png"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) onAvatarFile(file);
                }}
              />
            </div>
            {avatarError && (
              <p className="mt-1 text-xs text-status-danger">{avatarError}</p>
            )}
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
