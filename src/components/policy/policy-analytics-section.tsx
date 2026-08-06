'use client';

import { useTranslations } from 'next-intl';
import { Card, CardBody, Stack } from '@/components/ui';
import { ConditionFunnelPanel } from './condition-funnel-panel';

/**
 * 策略决策分析区（当前只挂 Phase 1 条件漏斗）。
 *
 * <p>存在的理由：面板自带一大票文案，若按详情页现有做法把每个 key 摊平到
 * `page.tsx` 的预渲染 translations 对象里，那个对象会迅速失控。这里改用
 * `useTranslations` 在客户端取——面板本就是 `'use client'`，没有额外代价。
 *
 * <p><b>★What-if 面板已撤下</b>（十二轮交叉审查结论）：按需重跑得到的
 * 成功子集带**选择偏差**——重跑失败往往与输入/词汇/策略路径相关，
 * 剩下的成功样本不是随机子集，据此出的业务数字可能方向正确而幅度全错。
 * 详见 `/api/policies/[id]/whatif` route 的头注释与 ADR 0033。
 *
 * <p>纯函数与四语文案保留，完整实现存于 `phase4-attempt-archive` 分支，
 * 等独立 replay run 模型落地后重新接回。
 */
export function PolicyAnalyticsSection({
  policyId,
  currentVersion,
}: {
  policyId: string;
  currentVersion: number;
}) {
  const t = useTranslations('conditionFunnel');


  const funnelLabels = {
    title: t('title'),
    subtitle: t('subtitle'),
    loading: t('loading'),
    empty: t('empty'),
    emptyHint: t('emptyHint'),
    sampleNote: t('sampleNote'),
    coverageNote: t('coverageNote'),
    neverMatchedTitle: t('neverMatchedTitle'),
    neverMatchedHint: t('neverMatchedHint'),
    truncatedNote: t('truncatedNote'),
    evaluated: t('evaluated'),
    matched: t('matched'),
    loadFailed: t('loadFailed'),
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

    </Stack>
  );
}
