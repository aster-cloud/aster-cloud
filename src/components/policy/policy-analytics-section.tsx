'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Card, CardBody, Stack } from '@/components/ui';
import { ConditionFunnelPanel } from './condition-funnel-panel';
import { WhatIfPanel } from './whatif-panel';

/**
 * 策略决策分析区（Phase 1 + Phase 4 的挂载点）。
 *
 * <p>存在的理由：两个面板都自带一大票文案，若按详情页现有做法把每个 key 摊平到
 * `page.tsx` 的预渲染 translations 对象里，那个对象会迅速失控。这里改用
 * `useTranslations` 在客户端取——面板本就是 `'use client'`，没有额外代价。
 *
 * <p><b>What-if 的呈现条件</b>：它比较的是**两个版本**，只有一个版本时无从比较，
 * 故默认不展开。这不是"藏起来"——展开入口常驻，只是不在没有可比对象时
 * 先渲染一个注定 insufficient 的面板去误导人。
 */
export function PolicyAnalyticsSection({
  policyId,
  currentVersion,
}: {
  policyId: string;
  currentVersion: number;
}) {
  const t = useTranslations('conditionFunnel');
  const tw = useTranslations('whatIf');

  // 默认与上一个版本比较；v1 没有上一版，故 What-if 不可用。
  const [baseVersion, setBaseVersion] = useState(Math.max(currentVersion - 1, 1));
  const canCompare = currentVersion > 1;

  const funnelLabels = {
    title: t('title'),
    subtitle: t('subtitle'),
    loading: t('loading'),
    empty: t('empty'),
    emptyHint: t('emptyHint'),
    sampleNote: t('sampleNote'),
    coverageNote: t('coverageNote'),
    deadTitle: t('deadTitle'),
    deadHint: t('deadHint'),
    evaluated: t('evaluated'),
    matched: t('matched'),
    loadFailed: t('loadFailed'),
  };

  const whatIfLabels = {
    title: tw('title'),
    subtitle: tw('subtitle'),
    loading: tw('loading'),
    loadFailed: tw('loadFailed'),
    empty: tw('empty'),
    emptyHint: tw('emptyHint'),
    assumptionTitle: tw('assumptionTitle'),
    changed: tw('changed'),
    newlyApproved: tw('newlyApproved'),
    newlyRejected: tw('newlyRejected'),
    positiveRate: tw('positiveRate'),
    valueDelta: tw('valueDelta'),
    valueUnavailable: tw('valueUnavailable'),
    confidenceLabel: tw('confidenceLabel'),
    valueConfidenceLabel: tw('valueConfidenceLabel'),
    confidenceInsufficient: tw('confidenceInsufficient'),
    confidenceLow: tw('confidenceLow'),
    confidenceModerate: tw('confidenceModerate'),
    coverageNote: tw('coverageNote'),
    caveatsTitle: tw('caveatsTitle'),
    caveat: {
      NO_OUTCOME_DATA: tw('caveat.NO_OUTCOME_DATA'),
      SAMPLE_TOO_SMALL: tw('caveat.SAMPLE_TOO_SMALL'),
      NO_APPROVED_BASELINE: tw('caveat.NO_APPROVED_BASELINE'),
      NO_VALUE_DATA: tw('caveat.NO_VALUE_DATA'),
      BASELINE_TOO_SMALL: tw('caveat.BASELINE_TOO_SMALL'),
      VALUE_SAMPLE_TOO_SMALL: tw('caveat.VALUE_SAMPLE_TOO_SMALL'),
    },
  };

  return (
    <Stack gap={6}>
      <Card>
        <CardBody className="pt-4">
          <ConditionFunnelPanel
            policyId={policyId}
            version={currentVersion}
            labels={funnelLabels}
          />
        </CardBody>
      </Card>

      {canCompare && (
        <Card>
          <CardBody className="pt-4">
            <Stack gap={3}>
              <label className="flex items-center gap-2 text-sm text-fg-muted">
                <span>{tw('title')}</span>
                <select
                  className="rounded border border-border bg-bg px-2 py-1 text-sm text-fg"
                  value={baseVersion}
                  onChange={(e) => setBaseVersion(Number(e.target.value))}
                >
                  {Array.from({ length: currentVersion - 1 }, (_, i) => i + 1).map((v) => (
                    <option key={v} value={v}>
                      v{v} → v{currentVersion}
                    </option>
                  ))}
                </select>
              </label>
              <WhatIfPanel
                policyId={policyId}
                baseVersion={baseVersion}
                targetVersion={currentVersion}
                labels={whatIfLabels}
              />
            </Stack>
          </CardBody>
        </Card>
      )}
    </Stack>
  );
}
