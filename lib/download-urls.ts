// Centralized download URLs for FundExecs OS native apps.
// Replace placeholder hrefs with real hosted URLs when assets are published.
export const DOWNLOAD_URLS = {
  ios:     "https://fundexecs.com/downloads/FundExecsOS.ipa",
  android: "https://fundexecs.com/downloads/FundExecsOS.apk",
  mac:     "https://fundexecs.com/downloads/FundExecsOS.dmg",
  windows: "https://fundexecs.com/downloads/FundExecsOS.exe",
  linux:   "https://fundexecs.com/downloads/FundExecsOS.AppImage",
} as const;

export type Platform = keyof typeof DOWNLOAD_URLS;

export const PLATFORM_META: Record<Platform, { label: string; sub: string; hint: string }> = {
  ios:     { label: "iOS",     sub: "iPhone & iPad",          hint: "iOS 16+" },
  android: { label: "Android", sub: "Phone & Tablet",         hint: "Android 10+" },
  mac:     { label: "macOS",   sub: "Apple Silicon & Intel",  hint: "macOS 13+" },
  windows: { label: "Windows", sub: "Desktop & Laptop",       hint: "Windows 10 / 11" },
  linux:   { label: "Linux",   sub: "AppImage",               hint: "Ubuntu / Fedora / Arch" },
};
