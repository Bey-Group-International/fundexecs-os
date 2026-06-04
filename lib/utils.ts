import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/**
 * Merge class names with clsx, then resolve Tailwind conflicts with
 * tailwind-merge. The standard `cn()` helper used across the UI kit so
 * variant defaults can be cleanly overridden by a caller's `className`.
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
