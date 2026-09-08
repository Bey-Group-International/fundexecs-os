// lib/meetings/device-prefs.ts
// Remembering which camera, microphone and speaker a member picked.
//
// Split out of the green room because the call needs it too: switching a device
// mid-call is a choice as deliberate as picking one before joining, and until
// this existed only the green room wrote the preference — so a member who
// swapped to their headset during a call was handed the laptop mic again the
// next time they joined.
//
// Storage access is wrapped rather than assumed: Safari in private mode throws
// on localStorage rather than returning null, and a device picker is not worth
// crashing a call over.

import { DEVICE_PREF_KEYS, type DeviceKind } from "./devices";

/** The remembered choice for a kind, or null when there is none or no storage. */
export function rememberedDevice(kind: DeviceKind): string | null {
  try {
    return window.localStorage.getItem(DEVICE_PREF_KEYS[kind]) || null;
  } catch {
    return null;
  }
}

/** Remember a choice for next time. A blank id means "system default" and is not stored. */
export function rememberDevice(kind: DeviceKind, deviceId: string): void {
  if (!deviceId) return;
  try {
    window.localStorage.setItem(DEVICE_PREF_KEYS[kind], deviceId);
  } catch {
    /* private mode / storage disabled — the picker still works for this call */
  }
}
