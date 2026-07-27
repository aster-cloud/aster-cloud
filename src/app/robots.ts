import type { MetadataRoute } from 'next';
import { locales, defaultLocale } from '@/i18n/config';

/**
 * Robots policy.
 *
 * Disallow user/dashboard/auth surfaces across every locale. With
 * `localePrefix: 'as-needed'`, /zh/login and /de/dashboard/ exist
 * as real URLs alongside their bare default-locale equivalents, so
 * each private path must be listed under every locale prefix to
 * actually block crawl.
 */

// Full inventory of authenticated/private route roots. Derived from
// src/app/[locale]/(auth)/* + src/app/[locale]/(dashboard)/*. When you
// add a new private route segment, append it here so robots.txt blocks
// it across every locale.
const PRIVATE_PATHS = [
  // (auth)/* — login + signup + recovery + first-run onboarding
  '/login',
  '/signup',
  '/forgot-password',
  '/reset-password',
  '/logout',
  '/onboarding',
  '/onboarding/',
  // Billing/lifecycle outside dashboard
  '/renew',
  // (dashboard)/* — every top-level segment is private. List both with
  // and without trailing slash so simple bot path matchers catch both.
  '/dashboard',
  '/dashboard/',
  '/admin',
  '/admin/',
  '/billing',
  '/billing/',
  '/domain-vocabularies',
  '/domain-vocabularies/',
  '/policies',
  '/policies/',
  '/reports',
  '/reports/',
  '/security',
  '/security/',
  '/settings',
  '/settings/',
  '/teams',
  '/teams/',
];

function expandPrivateAcrossLocales(): string[] {
  const out: string[] = [];
  for (const p of PRIVATE_PATHS) {
    out.push(p);
    for (const loc of locales) {
      if (loc === defaultLocale) continue;
      out.push(`/${loc}${p}`);
    }
  }
  return out;
}

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow: ['/', '/docs/', '/pricing', '/privacy', '/terms', '/equivalence'],
        disallow: [
          // Server endpoints — never crawl.
          '/api/',
          // 自托管媒体（demo 录音等)——请求遵循规范的爬虫（含守规矩的 AI 爬虫）不要抓取
          // 音频本体。注意：robots.txt 是"偏好表达"、依赖爬虫自愿遵守，非访问控制，也不阻止
          // 下载；不遵守规范的爬虫需靠 Cloudflare AI Crawl Control / WAF 在边缘强制阻断（面板配置）。
          '/audio/',
          // Auth + dashboard surfaces, expanded per locale.
          ...expandPrivateAcrossLocales(),
          // Next.js route-group folder names (defense-in-depth — these
          // shouldn't appear in URLs but Cloudflare sometimes resolves
          // odd paths and we want them blocked either way).
          '/(dashboard)/',
          '/(auth)/',
        ],
      },
    ],
    sitemap: 'https://aster-lang.cloud/sitemap.xml',
    host: 'https://aster-lang.cloud',
  };
}
