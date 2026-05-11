'use client';

import { useEffect } from 'react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { track, Events } from '@/lib/mixpanel';
import type { UpgradeReason, RecommendedPlan } from '@/lib/plan-quota';

/**
 * 升级阻塞 modal — 用户尝试越过 plan 限额时弹出
 *
 * 文案来自 messages/{en,zh,de}.json 的 upgradeBlocker namespace。
 * 触发 Mixpanel UPGRADE_BLOCKED_AT_REVIEW，是 NSM 漏斗 Free→Pro 的最强转化信号。
 */
interface UpgradeBlockerProps {
  open: boolean;
  reason: UpgradeReason;
  locale: string;
  recommendedPlan?: RecommendedPlan;
  usage?: number;
  limit?: number;
  onClose: () => void;
}

export function UpgradeBlocker({
  open,
  reason,
  locale,
  recommendedPlan = 'pro',
  usage,
  limit,
  onClose,
}: UpgradeBlockerProps) {
  const t = useTranslations('upgradeBlocker');

  useEffect(() => {
    if (open) {
      track(Events.UPGRADE_BLOCKED_AT_REVIEW, {
        reason,
        recommended_plan: recommendedPlan,
        usage,
        limit,
      });
    }
  }, [open, reason, recommendedPlan, usage, limit]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4"
      role="dialog"
      aria-modal="true"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-lg bg-white p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="mb-2 text-lg font-semibold text-gray-900">
          {t(`${reason}.title`, { limit: limit ?? 0 })}
        </h2>
        <p className="mb-6 text-sm text-gray-600">
          {t(`${reason}.body`, { limit: limit ?? 0 })}
        </p>
        <div className="flex justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            {t('dismiss')}
          </button>
          <Link
            href={`/${locale}/pricing?ref=upgrade-blocker&reason=${reason}`}
            className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700"
          >
            {t('viewPlans')}
          </Link>
        </div>
      </div>
    </div>
  );
}
