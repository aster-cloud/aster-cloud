/* @deployment-mode-hot-gate
 * reason: dynamic import of mixpanel-browser gated by direct
 *         __DEPLOYMENT_MODE__ macro. On-prem bundle aliases
 *         mixpanel-browser to false so even a missed gate cannot pull
 *         the SDK. All public helpers fail-soft (no-op) when SDK
 *         unavailable, matching pre-existing behavior with unset token.
 */
'use client';

// On-prem 客户用自己的 telemetry 系统（如 Sentry / Datadog），不接 Mixpanel。
// Public helpers (initMixpanel / identifyUser / track) 在 on-prem 全部 no-op；
// 调用方无需更改 —— 现有代码已经在 token 缺失时 fail-soft。

import type mixpanelBrowser from 'mixpanel-browser';

type MixpanelInstance = typeof mixpanelBrowser;

// MIXPANEL_TOKEN 故意延迟到 ensureMixpanel() 内读取（而非 module 顶部
// 常量），让 on-prem build 完全不出现 process.env.NEXT_PUBLIC_MIXPANEL_TOKEN
// 引用 —— terser 在 `if (__DEPLOYMENT_MODE__ !== 'saas') return null` 后
// 折叠剩余函数体即可。

let _mixpanelInstance: MixpanelInstance | null = null;
let _initialized = false;
let _initInFlight: Promise<MixpanelInstance | null> | null = null;

async function ensureMixpanel(): Promise<MixpanelInstance | null> {
  if (_mixpanelInstance) return _mixpanelInstance;
  if (typeof window === 'undefined') return null;

  // 编译期 mode 检查：on-prem 直接 no-op，整个剩余函数体（包括
  // MIXPANEL_TOKEN 读取 + dynamic import）被 terser 消除。这是唯一
  // 必需的 gate —— `__DEPLOYMENT_MODE__` 在 client 和 server bundle 都
  // 被 DefinePlugin 替换为字面量，process.env 镜像是冗余的。
  if (__DEPLOYMENT_MODE__ !== 'saas') return null;

  const MIXPANEL_TOKEN = process.env.NEXT_PUBLIC_MIXPANEL_TOKEN;
  if (!MIXPANEL_TOKEN) {
    if (!_initialized) {
      _initialized = true;
      console.warn('MIXPANEL_TOKEN is not set - analytics disabled');
    }
    return null;
  }

  if (_initInFlight) return _initInFlight;
  // 用 chunk-load 失败 / SDK init 异常会被 catch + 重置 _initInFlight，
  // 否则下一次调用会复用一个已 reject 的 promise，导致整会话埋点都死掉。
  _initInFlight = import('mixpanel-browser')
    .then((mod) => {
      const inst = mod.default;
      inst.init(MIXPANEL_TOKEN, {
        debug: process.env.NODE_ENV === 'development',
        track_pageview: true,
        persistence: 'localStorage',
      });
      _initialized = true;
      _mixpanelInstance = inst;
      return inst;
    })
    .catch((err) => {
      console.warn('[mixpanel] init failed', err);
      _initInFlight = null;
      return null;
    });
  return _initInFlight;
}

/**
 * 显式初始化（如启动期 warmup）。等价于 await ensureMixpanel() 但不返回值。
 * 现有调用方 fire-and-forget，签名保持同步以减少 diff。
 */
export function initMixpanel(): void {
  void ensureMixpanel();
}

/** 用户登录后绑定身份。on-prem / 缺 token / SSR 全部 no-op。 */
export function identifyUser(
  userId: string,
  properties?: Record<string, unknown>,
): void {
  void ensureMixpanel().then((mp) => {
    if (!mp) return;
    mp.identify(userId);
    if (properties) mp.people.set(properties);
  });
}

/** 上报事件。on-prem / 缺 token / SSR 全部 no-op。 */
export function track(
  event: string,
  properties?: Record<string, unknown>,
): void {
  void ensureMixpanel().then((mp) => {
    if (!mp) return;
    mp.track(event, properties);
  });
}

// Predefined events
export const Events = {
  // Auth
  SIGNUP: 'Signup',
  LOGIN: 'Login',
  LOGOUT: 'Logout',

  // Trial
  TRIAL_STARTED: 'Trial Started',
  TRIAL_EXPIRED: 'Trial Expired',

  // Policies
  POLICY_CREATED: 'Policy Created',
  POLICY_EXECUTED: 'Policy Executed',
  POLICY_SHARED: 'Policy Shared',

  // Billing
  CHECKOUT_STARTED: 'Checkout Started',
  SUBSCRIPTION_CREATED: 'Subscription Created',
  SUBSCRIPTION_CANCELLED: 'Subscription Cancelled',

  // Learning
  LESSON_STARTED: 'Lesson Started',
  LESSON_COMPLETED: 'Lesson Completed',
  BADGE_EARNED: 'Badge Earned',

  // Engagement
  PLAYGROUND_USED: 'Playground Used',
  DOCS_VIEWED: 'Docs Viewed',

  // 北极星指标 NSM (WAADR) — 详见 aster-deploy/docs/pm/03-telemetry-spec.md
  AI_DRAFT_GENERATED: 'ai_draft_generated',
  DRAFT_EDITED: 'draft_edited',
  DRAFT_PUBLISHED: 'draft_published',
  RULE_ROLLED_BACK: 'rule_rolled_back',

  // Pricing 漏斗 — 详见 aster-deploy/docs/pm/02-north-star-metric.md (Pricing 漏斗章节)
  PRICING_VIEWED: 'pricing_viewed',
  PRICING_TIER_SELECTED: 'pricing_tier_selected',
  PRICING_CHECKOUT_STARTED: 'pricing_checkout_started',
  PRICING_CONTACT_CLICKED: 'pricing_contact_clicked',

  // Trial 转化漏斗 — 详见 aster-deploy/docs/pm/05-pricing-packaging.md (F2.5)
  TRIAL_ENDING_EMAIL_SENT: 'trial_ending_email_sent',
  TRIAL_ENDING_EMAIL_CLICKED: 'trial_ending_email_clicked',
  TRIAL_CONVERTED_TO_PAID: 'trial_converted_to_paid',

  // 升级阻塞 — UpgradeBlocker 触发时上报，是 NSM 漏斗最强转化信号
  UPGRADE_BLOCKED_AT_REVIEW: 'upgrade_blocked_at_review',

  // ⌘K command palette — usage telemetry. PALETTE_OPENED tracks awareness;
  // PALETTE_COMMAND_SELECTED tracks utility. Together they tell us if the
  // feature earns its discovery cost.
  PALETTE_OPENED: 'palette_opened',
  PALETTE_COMMAND_SELECTED: 'palette_command_selected',

  // Docs experience — see .claude/plan/docs-enterprise-ux.md §7.1.
  // Probe is sampled to ~1/min/user via the hook's caching layer,
  // so we don't need a separate sampling step here. Properties stay
  // PII-free: no email/userId/tenantId fields.
  DOCS_SESSION_PROBE: 'docs_session_probe',
  DOCS_CTA_IMPRESSION: 'docs_cta_impression',
  DOCS_CTA_CLICKED: 'docs_cta_clicked',
  DOCS_SNIPPET_COPIED: 'docs_snippet_copied',
  DOCS_SNIPPET_OPENED: 'docs_snippet_opened',
  DOCS_SEARCH_OPENED: 'docs_search_opened',
  DOCS_SEARCH_RESULT_CLICKED: 'docs_search_result_clicked',
  DOCS_HOME_PERSONALIZED: 'docs_home_personalized',
  DOCS_TASK_VIEW_SWITCHED: 'docs_task_view_switched',
} as const;

/**
 * 计算 Levenshtein 编辑距离（用于 draft_edited.edit_distance）
 * 短文本（< 10K）够用；超长文本调用方应自行截断
 */
export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a) return b.length;
  if (!b) return a.length;

  const m = a.length;
  const n = b.length;
  let prev = new Array<number>(n + 1);
  let curr = new Array<number>(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;

  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    const ai = a.charCodeAt(i - 1);
    for (let j = 1; j <= n; j++) {
      const cost = ai === b.charCodeAt(j - 1) ? 0 : 1;
      curr[j] = Math.min(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
    }
    [prev, curr] = [curr, prev];
  }
  return prev[n];
}
