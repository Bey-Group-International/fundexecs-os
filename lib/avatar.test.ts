import {
  MAX_AVATAR_BYTES,
  avatarInitial,
  avatarObjectPath,
  avatarUrlWithVersion,
  isUploadedAvatarUrl,
  safeAvatarUrl,
  sniffImageType,
} from "./avatar";

const BUCKET_URL =
  "https://proj.supabase.co/storage/v1/object/public/member-avatars/org-1/principal-1.jpg";

describe("isUploadedAvatarUrl", () => {
  it("accepts a public URL from our own avatar bucket", () => {
    expect(isUploadedAvatarUrl(BUCKET_URL)).toBe(true);
    expect(isUploadedAvatarUrl(`  ${BUCKET_URL}  `)).toBe(true);
  });

  it("rejects the base64 data URLs the old /settings form wrote", () => {
    expect(isUploadedAvatarUrl("data:image/webp;base64,UklGRg==")).toBe(false);
  });

  it("rejects a remote hotlink, including an OAuth CDN photo", () => {
    expect(isUploadedAvatarUrl("https://lh3.googleusercontent.com/a/ACg8ocK")).toBe(false);
    expect(isUploadedAvatarUrl("https://evil.test/tracker.png")).toBe(false);
  });

  it("rejects a script-scheme payload", () => {
    expect(isUploadedAvatarUrl("javascript:alert(1)")).toBe(false);
    expect(isUploadedAvatarUrl("JavaScript:alert(1)")).toBe(false);
  });

  it("is not fooled by the bucket marker appearing outside the path", () => {
    expect(
      isUploadedAvatarUrl(
        "https://evil.test/?next=/storage/v1/object/public/member-avatars/org-1/x.jpg",
      ),
    ).toBe(false);
    expect(
      isUploadedAvatarUrl("https://evil.test/#/storage/v1/object/public/member-avatars/x.jpg"),
    ).toBe(false);
  });

  it("rejects empty and unparseable values", () => {
    expect(isUploadedAvatarUrl(null)).toBe(false);
    expect(isUploadedAvatarUrl(undefined)).toBe(false);
    expect(isUploadedAvatarUrl("")).toBe(false);
    expect(isUploadedAvatarUrl("not a url")).toBe(false);
    expect(isUploadedAvatarUrl("/storage/v1/object/public/member-avatars/org-1/x.jpg")).toBe(false);
  });
});

describe("safeAvatarUrl", () => {
  it("returns a normalized href for an uploaded photo", () => {
    expect(safeAvatarUrl(` ${BUCKET_URL} `)).toBe(BUCKET_URL);
  });

  it("returns null for anything not uploaded, so the caller shows initials", () => {
    expect(safeAvatarUrl("data:image/png;base64,iVBOR")).toBeNull();
    expect(safeAvatarUrl("https://lh3.googleusercontent.com/a/ACg8ocK")).toBeNull();
    expect(safeAvatarUrl(null)).toBeNull();
  });
});

describe("avatarObjectPath", () => {
  it("is deterministic per member, so a re-upload replaces in place", () => {
    expect(avatarObjectPath("org-1", "principal-1")).toBe("org-1/principal-1.jpg");
    expect(avatarObjectPath("org-1", "principal-1")).toBe(
      avatarObjectPath("org-1", "principal-1"),
    );
  });

  it("puts the org first, which is what the bucket RLS policies key on", () => {
    expect(avatarObjectPath("org-1", "principal-1").split("/")[0]).toBe("org-1");
  });
});

describe("avatarUrlWithVersion", () => {
  it("busts the CDN cache with the row's updated_at", () => {
    const stamp = "2026-09-12T10:00:00.000Z";
    expect(avatarUrlWithVersion(BUCKET_URL, stamp)).toBe(
      `${BUCKET_URL}?v=${Date.parse(stamp)}`,
    );
  });

  it("appends to a URL that already carries a query", () => {
    expect(avatarUrlWithVersion("https://x.test/a.jpg?w=64", "2026-09-12T10:00:00.000Z")).toContain(
      "?w=64&v=",
    );
  });

  it("leaves the URL alone when there is no usable timestamp", () => {
    expect(avatarUrlWithVersion(BUCKET_URL, null)).toBe(BUCKET_URL);
    expect(avatarUrlWithVersion(BUCKET_URL, "not a date")).toBe(BUCKET_URL);
  });
});

describe("sniffImageType", () => {
  const jpeg = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
  const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);
  const webp = Uint8Array.from([
    0x52, 0x49, 0x46, 0x46, 0x24, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50,
  ]);

  it("identifies the formats we accept by magic number", () => {
    expect(sniffImageType(jpeg)).toBe("image/jpeg");
    expect(sniffImageType(png)).toBe("image/png");
    expect(sniffImageType(webp)).toBe("image/webp");
  });

  it("rejects bytes that are not an image, whatever the upload claims", () => {
    // An SVG would be an XSS vector in a public bucket; HTML likewise.
    expect(sniffImageType(new TextEncoder().encode("<svg onload=alert(1)>"))).toBeNull();
    expect(sniffImageType(new TextEncoder().encode("<!doctype html>"))).toBeNull();
    expect(sniffImageType(new TextEncoder().encode("GIF89a"))).toBeNull();
  });

  it("rejects truncated input rather than reading past the end", () => {
    expect(sniffImageType(new Uint8Array())).toBeNull();
    expect(sniffImageType(Uint8Array.from([0xff, 0xd8]))).toBeNull();
    expect(sniffImageType(Uint8Array.from([0x89, 0x50, 0x4e, 0x47]))).toBeNull();
    // "RIFF" without the "WEBP" fourcc is some other RIFF container.
    expect(
      sniffImageType(Uint8Array.from([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x41, 0x56, 0x49, 0x20])),
    ).toBeNull();
  });
});

describe("avatarInitial", () => {
  it("uses the first letter of the name, uppercased", () => {
    expect(avatarInitial("ana member")).toBe("A");
    expect(avatarInitial("  bea ")).toBe("B");
  });

  it("falls back when there is no usable name", () => {
    expect(avatarInitial(null)).toBe("M");
    expect(avatarInitial("")).toBe("M");
    expect(avatarInitial("   ")).toBe("M");
  });
});

describe("MAX_AVATAR_BYTES", () => {
  it("leaves room for a 512px JPEG portrait without inviting a multi-MB upload", () => {
    expect(MAX_AVATAR_BYTES).toBe(600 * 1024);
  });
});
