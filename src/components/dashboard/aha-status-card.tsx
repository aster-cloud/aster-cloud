'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';

interface AhaAchieved {
  achieved: true;
  achievedAt: string;
  hoursToFirst: number | null;
  withinAhaWindow: boolean | null;
  ahaWindowHours: number;
}

interface AhaPending {
  achieved: false;
  hoursSinceSignup: number;
  hoursRemaining: number;
  ahaWindowHours: number;
  expired: boolean;
}

type AhaStatus = AhaAchieved | AhaPending;

/**
 * AHA Moment 卡片
 *
 * 已达成：庆祝消息 + 用时统计
 * 未达成 + 在 24h 窗口内：进度条 + 剩余时间 + 首条策略 CTA
 * 已超出 24h 窗口：仍提示 publish 首条策略（无窗口压力）
 */
export function AhaStatusCard({ locale }: { locale: string }) {
  const [data, setData] = useState<AhaStatus | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/user/aha-status')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d && 'achieved' in d) setData(d as AhaStatus);
      })
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
        <div className="h-4 w-24 animate-pulse rounded bg-gray-200" />
        <div className="mt-2 h-6 w-40 animate-pulse rounded bg-gray-200" />
      </div>
    );
  }

  if (!data) return null;

  if (data.achieved) {
    return (
      <div className="rounded-lg border border-green-200 bg-green-50 p-4 shadow-sm">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-xs font-medium uppercase tracking-wider text-green-700">
              🎉 First policy published
            </p>
            <p className="mt-1 text-lg font-semibold text-green-900">
              {data.hoursToFirst !== null
                ? `${data.hoursToFirst} hours after signup`
                : 'Achieved'}
            </p>
            {data.withinAhaWindow === true && (
              <p className="mt-1 text-xs text-green-700">
                ✨ Inside the {data.ahaWindowHours}h AHA window — way to go!
              </p>
            )}
          </div>
        </div>
      </div>
    );
  }

  if (data.expired) {
    // 超出 AHA 窗口但仍未 publish — 温和提示，不威胁
    return (
      <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
        <p className="text-xs font-medium uppercase tracking-wider text-gray-500">
          Publish your first policy
        </p>
        <p className="mt-1 text-sm text-gray-700">
          Ready to ship your first rule? It only takes a few minutes.
        </p>
        <Link
          href={`/${locale}/policies/new`}
          className="mt-2 inline-block text-sm font-medium text-primary hover:text-primary-hover"
        >
          Create policy →
        </Link>
      </div>
    );
  }

  // 在 AHA 窗口内 — 显示倒计时鼓励
  const progressPercent = Math.min(
    100,
    Math.round((data.hoursSinceSignup / data.ahaWindowHours) * 100),
  );

  return (
    <div className="rounded-lg border border-primary/30 bg-primary-subtle p-4 shadow-sm">
      <p className="text-xs font-medium uppercase tracking-wider text-primary-hover">
        AHA Moment Challenge
      </p>
      <p className="mt-1 text-sm font-medium text-primary-active">
        Publish your first policy within {data.ahaWindowHours}h of signup
      </p>
      <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-primary-subtle">
        <div
          className="h-full bg-primary transition-all"
          style={{ width: `${progressPercent}%` }}
        />
      </div>
      <p className="mt-2 text-xs text-primary-hover">
        ⏰ {data.hoursRemaining.toFixed(1)}h remaining
      </p>
      <Link
        href={`/${locale}/policies/new`}
        className="mt-3 inline-block rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-white hover:bg-primary-hover"
      >
        Create policy →
      </Link>
    </div>
  );
}
