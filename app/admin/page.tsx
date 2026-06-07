import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

export const metadata: Metadata = {
  title: { absolute: 'FundExecs OS — Admin' },
  description: 'Members, roles, and beta invites — fund administration inside Settings.'
};

/**
 * Admin now lives inside Settings as the owner/admin-only "Admin" section
 * (members & roles + magic-link beta invites), rendered by `SettingsView` from
 * `app/admin/AdminView.tsx`. This route redirects to that section so there's a
 * single, consistent entry point.
 */
export default function AdminPage() {
  redirect('/settings#admin');
}
