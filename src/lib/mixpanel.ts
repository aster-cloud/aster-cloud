'use client';

import mixpanel from 'mixpanel-browser';

const MIXPANEL_TOKEN = process.env.NEXT_PUBLIC_MIXPANEL_TOKEN;

// Initialize Mixpanel (client-side only)
let initialized = false;

export function initMixpanel() {
  if (typeof window === 'undefined') return;
  if (initialized) return;
  if (!MIXPANEL_TOKEN) {
    console.warn('MIXPANEL_TOKEN is not set - analytics disabled');
    return;
  }

  mixpanel.init(MIXPANEL_TOKEN, {
    debug: process.env.NODE_ENV === 'development',
    track_pageview: true,
    persistence: 'localStorage',
  });

  initialized = true;
}

// Identify user after login
export function identifyUser(userId: string, properties?: Record<string, unknown>) {
  if (!initialized) return;

  mixpanel.identify(userId);
  if (properties) {
    mixpanel.people.set(properties);
  }
}

// Track events
export function track(event: string, properties?: Record<string, unknown>) {
  if (!initialized) return;

  mixpanel.track(event, properties);
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
