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
 * <p><b>What-if 面板（ADR 0034）</b>：组件已按异步 ReplayBatch 模型重做
 * （{@code whatif-batch-panel.tsx}），但**尚未挂载**——还差两个真实输入：
 * <ul>
 *   <li><b>目标版本</b>：What-If 是「当前版本 vs 另一个版本」的比较，
 *       需要一个版本选择器。详情页现在只有 currentVersion。</li>
 *   <li><b>entitled</b>：租户是否有 What-If 权益，需从 plan 读出后传下来。</li>
 * </ul>
 * 在这两者到位前挂载只能靠编造默认值——那正是上一版
 * {@code ?? 0} 兜底的同类错误：用一个看似正常的值掩盖「输入其实不存在」。
 * 上一版（Phase 4）因**选择偏差**撤下——它允许「200 条发起、30 条成功」
 * 就对那 30 条出完整业务数字，而重跑失败与输入/词汇/策略路径相关，
 * 成功子集不是随机样本。新模型：窗口内**全量**跑、**全部成功**才出数字，
 * 任一条失败即整批拒答。
 *
 * <p>★呈现层的三条硬约束（见面板注释）：窗口口径与数字同屏、
 * 拒答零业务数字、进度只给已处理数不给成功数。
 *
 * <p>★面板文案当前为英文硬编码：Phase 4 的四语文案只存在于已关闭的分支，
 * 补文案要走跨仓发版链（ui-messages → 发版 → cloud bump），作为独立工作项推进。
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
