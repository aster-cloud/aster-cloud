// /admin/* sub-shell — permission gate only.
//
// Previous iteration rendered a red "ADMIN CONSOLE" chrome bar + an
// AdminSidebar (left rail). Both are now removed:
//   - The red badge was a visual cue that the admin had crossed into a
//     privileged context. With the new sidebar IA (P1-1), admin
//     surfaces are already grouped under their own "ADMIN" heading in
//     the primary sidebar — the badge duplicated that signal and
//     fragmented the chrome.
//   - AdminSidebar lived alongside the main sidebar = two parallel
//     navs. Now there's one nav (the main DashboardSidebar), so the
//     sub-shell stops at "admin gate + ReadOnlyBanner".
//
// What remains:
//   - `isAdminFromSession()` short-circuits non-admins to notFound() so
//     the existence of /admin/* isn't leakable to non-admins. Each
//     leaf page (risk-tier, ai-circuit-breaker) also runs the check —
//     intentional defense-in-depth.
//   - ReadOnlyBanner surfaces license read-only state on on-prem
//     deploys (SaaS = never gated).

import { notFound } from 'next/navigation';
import { setRequestLocale } from 'next-intl/server';
import { isAdminFromSession } from '@/lib/admin-auth';
import { ReadOnlyBanner } from '@/components/admin/read-only-banner';
import { isLicenseReadOnlyGated } from '@/lib/license-runtime-gate';

type Props = {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
};

export const dynamic = 'force-dynamic';

export default async function AdminLayout({ children, params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);

  const admin = await isAdminFromSession();
  if (!admin) {
    notFound();
  }

  // grace-expired / revoked / expired / malformed / missing 时显示
  // read-only banner — 强提示 operator 必须先处理 license 问题
  // （SaaS 永远 not gated; the short-circuit lives in isLicenseReadOnlyGated）。
  const readOnlyGate = await isLicenseReadOnlyGated();

  return (
    <>
      {readOnlyGate.gated && readOnlyGate.reason && (
        <ReadOnlyBanner reason={readOnlyGate.reason} />
      )}
      {children}
    </>
  );
}
