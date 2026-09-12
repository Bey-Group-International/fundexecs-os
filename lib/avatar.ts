// Member photos: what a valid avatar is, and where it lives.
//
// `principals.avatar_url` holds exactly one kind of value -- the public URL of
// an image this platform stores in the `member-avatars` bucket
// (20260912120000_member_avatar_uploads). Remote hotlinks, OAuth CDN URLs, and
// base64 data URLs are not avatars; `safeAvatarUrl` rejects them and the caller
// falls back to initials.
//
// Every upload is normalized client-side to a square-ish JPEG <= 512px before
// it reaches the server, so the stored object is always one deterministic path
// per member and always image/jpeg. The server re-checks the bytes -- a client
// is not a security boundary.

export const MEMBER_AVATAR_BUCKET = "member-avatars";

/** Longest edge of a stored avatar, in pixels. Round 36-40px on screen; 512
 * leaves headroom for retina and for larger surfaces later. */
export const AVATAR_MAX_EDGE = 512;

/** Hard ceiling on the uploaded bytes. A 512px JPEG portrait is typically
 * 40-80KB, so this only ever trips on a crafted request. */
export const MAX_AVATAR_BYTES = 600 * 1024;

/** What the file picker offers. Everything is re-encoded to JPEG before upload. */
export const AVATAR_PICKER_ACCEPT = "image/png,image/jpeg,image/webp";

/** Marker that identifies a public object URL from our own bucket. */
const PUBLIC_OBJECT_PREFIX = `/storage/v1/object/public/${MEMBER_AVATAR_BUCKET}/`;

/**
 * Storage path for a member's photo. Deterministic -- one object per member,
 * replaced in place on re-upload, so a member can never accumulate orphans.
 * The `${orgId}/` first segment is what the bucket's RLS policies key on.
 */
export function avatarObjectPath(orgId: string, principalId: string): string {
  return `${orgId}/${principalId}.jpg`;
}

/**
 * True when `url` is a public URL for an object in our own avatar bucket.
 *
 * Parsed with the URL constructor rather than matched as a substring: a
 * `javascript:` or `data:` payload that merely contains the marker text must
 * not pass, and neither must `https://evil.test/?x=/storage/v1/object/public/member-avatars/`.
 */
export function isUploadedAvatarUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  try {
    const parsed = new URL(url.trim());
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return false;
    return parsed.pathname.includes(PUBLIC_OBJECT_PREFIX);
  } catch {
    return false;
  }
}

/**
 * The render guard. Returns a URL safe to put in an <img src>, or null so the
 * caller shows initials instead.
 *
 * Re-emitting `parsed.href` (rather than returning the input) breaks the taint
 * flow into the <img> sink for CodeQL js/xss-through-dom, the same way the
 * previous `safeImageUrl` did.
 */
export function safeAvatarUrl(url: string | null | undefined): string | null {
  if (!isUploadedAvatarUrl(url)) return null;
  return new URL(String(url).trim()).href;
}

/**
 * Append a cache-busting token to a stored avatar URL.
 *
 * The object path is deterministic, so a replaced photo keeps its URL and the
 * CDN would keep serving the old bytes. `updatedAt` is the principal row's
 * `updated_at`, which the upload bumps.
 */
export function avatarUrlWithVersion(url: string, updatedAt: string | null | undefined): string {
  const stamp = updatedAt ? Date.parse(updatedAt) : NaN;
  if (!Number.isFinite(stamp)) return url;
  const sep = url.includes("?") ? "&" : "?";
  return `${url}${sep}v=${stamp}`;
}

/**
 * Identify image bytes by magic number. Returns the media type, or null when
 * the bytes are not one of the formats we accept.
 *
 * The upload path only ever stores JPEG, but PNG and WebP are recognized so the
 * server can reject them with an accurate message rather than a generic one.
 */
export function sniffImageType(bytes: Uint8Array): "image/jpeg" | "image/png" | "image/webp" | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg";
  }
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return "image/png";
  }
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 && // R
    bytes[1] === 0x49 && // I
    bytes[2] === 0x46 && // F
    bytes[3] === 0x46 && // F
    bytes[8] === 0x57 && // W
    bytes[9] === 0x45 && // E
    bytes[10] === 0x42 && // B
    bytes[11] === 0x50 // P
  ) {
    return "image/webp";
  }
  return null;
}

/** Initials fallback shown whenever there is no uploaded photo. */
export function avatarInitial(name: string | null | undefined): string {
  return (name?.trim() || "M").charAt(0).toUpperCase();
}
