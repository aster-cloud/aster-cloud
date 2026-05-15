/**
 * Server-safe half of the ⌘K command palette.
 *
 * Why split: command-palette.tsx is a 'use client' module because the
 * React component needs hooks + window listeners. But the layout (a
 * Server Component) needs to build the command list with localized
 * labels from next-intl, then pass it as a prop. Calling a function
 * exported from a 'use client' module on the server throws at runtime
 * ("Attempted to call buildCommands() from the server but buildCommands
 * is on the client"). Splitting keeps the catalog + types in a plain
 * module that both server and client can import freely.
 */

import {
  FileText,
  Home,
  KeyRound,
  Settings,
  ShieldCheck,
  Sparkles,
  Users,
  Wallet,
} from 'lucide-react';

export interface Command {
  /** Stable id for keying React lists and analytics events. */
  id: string;
  /** Visible label — i18n-translated upstream and passed in via props. */
  label: string;
  /** Short helper text shown under the label. */
  hint?: string;
  /** Lucide icon component. */
  icon: React.ComponentType<{ className?: string }>;
  /** Route (locale prefix added by router.push call site). */
  href: string;
  /** Section header in the rendered list. */
  group: 'navigate' | 'create' | 'settings';
  /** Optional list of extra search keywords (e.g. translations of the label
   *  in other languages so a 中文 user can still search "policy"). */
  keywords?: string[];
}

/**
 * Build the default command list. The layout passes localized labels
 * (already translated via next-intl on the server) so this stays
 * i18n-clean. The keyword list is intentionally tri-lingual on the
 * highest-traffic items so 中文 / Deutsch users can still type
 * "policy" / "settings" and find the right command.
 */
export interface BuildCommandsArgs {
  /** Locale prefix already applied to hrefs ('' for default, '/zh' etc). */
  routePrefix: string;
  /** Labels piped through from server-side getTranslations. */
  labels: {
    dashboard: string;
    policies: string;
    newPolicy: string;
    reports: string;
    teams: string;
    security: string;
    billing: string;
    settings: string;
    apiKeys: string;
    aiKeys: string;
    aiAssistant: string;
  };
  /** Optional viewer-only flag to hide create commands when role is viewer. */
  canCreate?: boolean;
  /** Whether to expose billing entry (admins only). */
  showBilling?: boolean;
}

export function buildCommands({
  routePrefix, labels, canCreate = true, showBilling = true,
}: BuildCommandsArgs): Command[] {
  const p = routePrefix;
  const cmds: Command[] = [
    { id: 'dashboard',  group: 'navigate', icon: Home,        label: labels.dashboard,  href: `${p}/dashboard`,         keywords: ['仪表盘', 'übersicht'] },
    { id: 'policies',   group: 'navigate', icon: FileText,    label: labels.policies,   href: `${p}/policies`,          keywords: ['policy', '策略', 'richtlinien'] },
    { id: 'reports',    group: 'navigate', icon: FileText,    label: labels.reports,    href: `${p}/reports`,           keywords: ['report', '报告', 'berichte'] },
    { id: 'teams',      group: 'navigate', icon: Users,       label: labels.teams,      href: `${p}/teams`,             keywords: ['team', '团队'] },
    { id: 'security',   group: 'navigate', icon: ShieldCheck, label: labels.security,   href: `${p}/security`,          keywords: ['security', '安全'] },

    ...(canCreate
      ? ([{ id: 'new-policy', group: 'create', icon: Sparkles, label: labels.newPolicy, href: `${p}/policies/new`, keywords: ['create', '新建', 'neu'] }] as Command[])
      : []),

    ...(showBilling
      ? ([{ id: 'billing', group: 'settings', icon: Wallet, label: labels.billing, href: `${p}/billing`, keywords: ['plan', '账单'] }] as Command[])
      : []),
    { id: 'settings',  group: 'settings', icon: Settings, label: labels.settings, href: `${p}/settings`, keywords: ['settings', '设置'] },
    { id: 'api-keys',  group: 'settings', icon: KeyRound, label: labels.apiKeys,  href: `${p}/settings/api-keys`, keywords: ['api', 'token', '密钥'] },
    { id: 'ai-keys',   group: 'settings', icon: Sparkles, label: labels.aiKeys,   href: `${p}/settings/ai-keys`,  keywords: ['byok', 'openai', 'ai 密钥'] },
  ];
  return cmds;
}
