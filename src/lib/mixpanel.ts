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
} as const;
