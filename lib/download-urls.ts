// Centralized download URLs for FundExecs OS native apps.
// Replace placeholder hrefs with real hosted URLs when assets are published.
export const DOWNLOAD_URLS = {
  ios: "https://fundexecs.com/downloads/FundExecsOS.ipa",
  android: "https://fundexecs.com/downloads/FundExecsOS.apk",
  mac: "https://fundexecs.com/downloads/FundExecsOS.dmg",
  windows: "https://fundexecs.com/downloads/FundExecsOS.exe",
  linux: "https://fundexecs.com/downloads/FundExecsOS.AppImage",
} as const;

export type Platform = keyof typeof DOWNLOAD_URLS;

export const PLATFORM_META: Record<Platform, { label: string; hint: string; icon: string }> = {
  ios:     { label: "iOS",     hint: "iPhone & iPad",       icon: "" },
  android: { label: "Android", hint: "Android 10+",         icon: "" },
  mac:     { label: "macOS",   hint: "Apple Silicon & Intel", icon: "" },
  windows: { label: "Windows", hint: "Windows 10 / 11",     icon: "" },
  linux:   { label: "Linux",   hint: ".AppImage",            icon: "" },
};
