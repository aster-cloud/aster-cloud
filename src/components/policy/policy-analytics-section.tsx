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
 * <p><b>★What-if 面板当前不挂载。</b>后端 `/whatif` 一律返回 409
 * REPLAY_REQUIRED —— 当前数据模型下跨版本逐条对齐在合法数据上不可能成立
 * （`Execution.id` 是主键，一行只属于一个版本，两版本的 id 交集恒为空）。
 * 详见该 route 的头注释。
 *
 * <p>挂一个必然报错的面板不是"功能待完善"，是给用户一个坏掉的入口。
 * 面板组件已一并删除——它的 `?? 0` 兜底会把「字段缺失」渲染成看似正常的 0，
 * 与"拒绝给数字"的初衷相反，留着等于给未来埋雷。纯函数
 * `estimateWhatIf` 保留（逻辑正确且有测试），届时按新的数据模型重写呈现层。
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
