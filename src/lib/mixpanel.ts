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

const MIXPANEL_TOKEN = process.env.NEXT_PUBLIC_MIXPANEL_TOKEN;
const NEXT_PUBLIC_DEPLOYMENT_MODE =
  process.env.NEXT_PUBLIC_DEPLOYMENT_MODE === 'on-prem' ? 'on-prem' : 'saas';

let _mixpanelInstance: MixpanelInstance | null = null;
let _initialized = false;
let _initInFlight: Promise<MixpanelInstance | null> | null = null;

async function ensureMixpanel(): Promise<MixpanelInstance | null> {
  if (_mixpanelInstance) return _mixpanelInstance;
  if (typeof window === 'undefined') return null;

  // 编译期 mode 检查：on-prem 直接 no-op，dynamic import 表达式被消除。
  if (__DEPLOYMENT_MODE__ !== 'saas') return null;
  // 客户端镜像（同 build-time literal）也要 mode 检查，避免某些边缘
  // hydration 路径绕过编译期常量。
  if (NEXT_PUBLIC_DEPLOYMENT_MODE !== 'saas') return null;
  if (!MIXPANEL_TOKEN) {
    if (!_initialized) {
      _initialized = true;
      console.warn('MIXPANEL_TOKEN is not set - analytics disabled');
    }
    return null;
  }

  if (_initInFlight) return _initInFlight;
  _initInFlight = (async () => {
    const mod = await import('mixpanel-browser');
    const inst = mod.default;
    inst.init(MIXPANEL_TOKEN, {
      debug: process.env.NODE_ENV === 'development',
      track_pageview: true,
      persistence: 'localStorage',
    });
    _initialized = true;
    _mixpanelInstance = inst;
    return inst;
  })();
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
