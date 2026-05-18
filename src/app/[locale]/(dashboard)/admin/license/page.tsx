// /admin/license — on-prem 企业版 license 状态页。
//
// 服务端解析 process.env.LICENSE_KEY，传给客户端组件渲染。
// SaaS build：notFound（CAN_LICENSE = false）。
// admin layout 已守门 admin 权限；此页不重复检查（layout 失误退化的
// 防御已经在 layout.tsx 注释中说明）。

import { setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { isAdminFromSession } from '@/lib/admin-auth';
import { CAN_LICENSE } from '@/lib/deployment-mode';
import { parseLicenseKey } from '@/lib/license';
import { LicenseStatusContent } from './license-content';

type Props = {
  params: Promise<{ locale: string }>;
};

export const dynamic = 'force-dynamic';

export default async function LicensePage({ params }: Props) {
  if (!CAN_LICENSE) {
    notFound();
  }

  // Defense-in-depth：与 PR-3 + PR-4 同模式 —— admin/layout.tsx 守
  // admin 权限是主守门，但叶子页也独立检查一遍，避免未来 layout
  // 重构意外漏掉这道闸。non-admin 直接 notFound（不暴露页面存在）。
  const admin = await isAdminFromSession();
  if (!admin) {
    notFound();
  }

  const { locale } = await params;
  setRequestLocale(locale);

  // 服务端一次性解析，避免客户端 hydration 后再 fetch 闪烁；客户端组件
  // 只负责渲染 + 提供 copy-to-clipboard 等交互。
  const result = parseLicenseKey(process.env.LICENSE_KEY);

  return <LicenseStatusContent result={result} />;
}

// 给 admin/layout/AdminSidebar 用作 active route 检测（不强制）
export const metadata = {
  title: 'License',
};
