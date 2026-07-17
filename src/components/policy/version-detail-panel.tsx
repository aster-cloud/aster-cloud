'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import type { PolicyVersionStatus } from '@/lib/prisma';
import { VersionStatusBadge } from './version-status-badge';
import { extractErrorMessage } from '@/lib/api/error-envelope';
import { ALL_ALIAS_KINDS } from './policy-alias-types';
import { STRUCTURAL_KINDS } from '@/lib/policy-alias-shared';

/** kind → 规范关键词拼写（如 FUNC_TO→'Rule', IF→'If'），审批用。 */
const KIND_CANONICAL: Record<string, string> = Object.fromEntries(
  ALL_ALIAS_KINDS.map((k) => [k.kind, k.symbol]),
);

export interface AliasCanonicalRow {
  readonly kind: string;
  readonly canonical: string;
  readonly phrases: string[];
  readonly structural: boolean;
}

/**
 * H1 安全护栏②的纯逻辑：把冻结的 canonical JSON 别名集（kind→string[]）解析成
 * 「别名短语 → 规范关键词」行，结构词排前。解析失败返回 null（外层回退纯文本告警）。
 * 抽成纯函数便于单测钉住 kind→规范拼写映射与结构词判定这两项安全关键行为。
 */
export function buildAliasCanonicalRows(aliasSetJson: string): AliasCanonicalRow[] | null {
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(aliasSetJson) as Record<string, unknown>;
  } catch {
    return null;
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return null;
  }
  const out: AliasCanonicalRow[] = [];
  for (const [kind, phrases] of Object.entries(parsed)) {
    if (!Array.isArray(phrases)) continue;
    out.push({
      kind,
      canonical: KIND_CANONICAL[kind] ?? kind,
      phrases: phrases.filter((p): p is string => typeof p === 'string'),
      structural: STRUCTURAL_KINDS.has(kind),
    });
  }
  // 结构词排前（审批优先看高风险项）
  out.sort((a, b) => Number(b.structural) - Number(a.structural));
  return out;
}

/**
 * H1 安全护栏②：审批时把冻结的别名集展成「别名短语 → 规范关键词」映射表，
 * 结构词（Module/Rule/If…）行**高亮告警**——防止有人用无害措辞把结构词伪装成
 * 普通运算符骗过审批。
 *
 * <p>展示真实结构而非直接跑 canonicalize（避免把整套编译器 + locale 判定塞进
 * 详情面板 bundle）：每条别名旁标注它实际归一到的规范结构词，审批者一眼可辨。
 */
function AliasCanonicalMap({ aliasSetJson }: { aliasSetJson: string }) {
  const rows = useMemo(() => buildAliasCanonicalRows(aliasSetJson), [aliasSetJson]);

  if (!rows) return null;
  const hasStructural = rows.some((r) => r.structural);

  return (
    <div className="rounded-lg border border-border dark:border-gray-700 overflow-hidden">
      <div className="bg-bg-subtle dark:bg-gray-900 px-3 py-2 text-sm font-medium text-fg dark:text-gray-200">
        规范化结构对照（审批依据）
      </div>
      {hasStructural && (
        <div className="border-b border-border dark:border-gray-700 bg-red-50 px-3 py-2 text-xs text-red-800 dark:bg-red-950/40 dark:text-red-200">
          ⚠ 本版本对<strong>结构关键词</strong>使用了别名。请逐条确认下表右列的规范结构与源码意图一致后再批准。
        </div>
      )}
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border dark:border-gray-700 text-left text-xs text-fg-muted dark:text-fg-subtle">
            <th className="px-3 py-2 font-medium">别名短语（源码中所见）</th>
            <th className="px-3 py-2 font-medium">实际规范结构</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr
              key={r.kind}
              className={`border-b border-border last:border-0 dark:border-gray-700 ${
                r.structural ? 'bg-red-50/60 dark:bg-red-950/20' : ''
              }`}
            >
              <td className="px-3 py-2 font-mono text-fg dark:text-gray-200">
                {r.phrases.map((p) => `"${p}"`).join('、')}
              </td>
              <td className="px-3 py-2">
                <span className="font-mono font-medium text-fg dark:text-gray-100">{r.canonical}</span>
                {r.structural && (
                  <span className="ml-2 rounded bg-red-100 px-1.5 py-0.5 text-[10px] font-medium text-red-700 dark:bg-red-900/50 dark:text-red-200">
                    结构词
                  </span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

interface ApprovalRecord {
  id: string;
  approverId: string;
  decision: 'APPROVED' | 'REJECTED' | 'REQUESTED_CHANGES';
  comment: string | null;
  createdAt: string;
}

interface VersionDetail {
  id: string;
  version: number;
  source: string | null;
  content: string;
  sourceHash: string | null;
  prevHash: string | null;
  status: PolicyVersionStatus;
  isDefault: boolean;
  releaseNote: string | null;
  aliasSet: string | null;
  createdBy: string;
  createdAt: string;
  deprecatedAt: string | null;
  deprecatedBy: string | null;
  archivedAt: string | null;
  archivedBy: string | null;
  approvals: ApprovalRecord[];
}

interface VersionDetailPanelProps {
  policyId: string;
  version: number;
  onClose?: () => void;
}

const decisionLabels: Record<string, { label: string; color: string }> = {
  APPROVED: { label: '批准', color: 'text-green-600 dark:text-green-400' },
  REJECTED: { label: '拒绝', color: 'text-red-600 dark:text-red-400' },
  REQUESTED_CHANGES: { label: '需修改', color: 'text-yellow-600 dark:text-yellow-400' },
};

export function VersionDetailPanel({
  policyId,
  version,
  onClose,
}: VersionDetailPanelProps) {
  const [detail, setDetail] = useState<VersionDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'source' | 'metadata' | 'approvals'>('source');

  const fetchDetail = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const response = await fetch(`/api/v1/policies/${policyId}/versions/${version}`);
      const data = await response.json();

      if (response.ok) {
        setDetail(data);
      } else {
        setError(extractErrorMessage(data) || '获取版本详情失败');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '未知错误');
    } finally {
      setLoading(false);
    }
  }, [policyId, version]);

  useEffect(() => {
    // 依赖变化时异步拉取版本详情；setState 均在 await 之后触发，
    // 属正常数据加载副作用，非渲染期同步 setState。
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchDetail();
  }, [fetchDetail]);

  if (loading) {
    return (
      <div className="bg-bg dark:bg-gray-800 rounded-lg shadow-lg p-6">
        <div className="animate-pulse space-y-4">
          <div className="h-8 bg-bg-muted dark:bg-gray-700 rounded w-1/3" />
          <div className="h-64 bg-bg-muted dark:bg-gray-700 rounded" />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-bg dark:bg-gray-800 rounded-lg shadow-lg p-6">
        <div className="text-red-500 dark:text-red-400">{error}</div>
      </div>
    );
  }

  if (!detail) {
    return null;
  }

  const sourceCode = detail.source ?? detail.content;

  return (
    <div className="bg-bg dark:bg-gray-800 rounded-lg shadow-lg">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-border dark:border-gray-700">
        <div className="flex items-center gap-3">
          <h2 className="text-xl font-semibold text-fg dark:text-white">
            v{detail.version}
          </h2>
          <VersionStatusBadge status={detail.status} isDefault={detail.isDefault} />
        </div>
        {onClose && (
          <button
            onClick={onClose}
            className="text-fg-muted hover:text-fg dark:text-fg-subtle dark:hover:text-gray-200"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        )}
      </div>

      {/* Tabs */}
      <div className="border-b border-border dark:border-gray-700">
        <nav className="flex -mb-px px-6">
          {[
            { id: 'source' as const, label: '源码' },
            { id: 'metadata' as const, label: '元数据' },
            { id: 'approvals' as const, label: `审批记录 (${detail.approvals.length})` },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`py-3 px-4 text-sm font-medium border-b-2 transition-colors ${
                activeTab === tab.id
                  ? 'border-primary text-primary dark:text-primary'
                  : 'border-transparent text-fg-muted hover:text-fg dark:text-fg-subtle dark:hover:text-gray-300'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </nav>
      </div>

      {/* Content */}
      <div className="p-6">
        {activeTab === 'source' && (
          <div className="space-y-4">
            {detail.releaseNote && (
              <div className="text-sm text-fg-muted dark:text-fg-subtle bg-bg-subtle dark:bg-gray-900 p-3 rounded-lg">
                {detail.releaseNote}
              </div>
            )}
            {/* R30+ audit P2：从 raw gray ramp 改成 design tokens 同步 dark mode */}
            <pre className="bg-bg-inverse text-fg-inverse p-4 rounded-lg overflow-x-auto text-sm font-mono max-h-[500px] overflow-y-auto dark:bg-zinc-900 dark:text-zinc-100">
              {sourceCode}
            </pre>
            {detail.aliasSet && (
              <>
                <div className="rounded-lg border border-amber-300/40 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-400/30 dark:bg-amber-950/30 dark:text-amber-100">
                  此版本使用了关键词别名。源码中的措辞经下表归一到真实结构后再编译执行——请对照确认。
                </div>
                <AliasCanonicalMap aliasSetJson={detail.aliasSet} />
              </>
            )}
          </div>
        )}

        {activeTab === 'metadata' && (
          <div className="space-y-4">
            <MetadataItem label="版本 ID" value={detail.id} mono />
            <MetadataItem label="版本号" value={`v${detail.version}`} />
            <MetadataItem label="状态" value={detail.status} />
            <MetadataItem label="是否默认" value={detail.isDefault ? '是' : '否'} />
            <MetadataItem label="源码哈希" value={detail.sourceHash || '无'} mono />
            <MetadataItem label="前一版本哈希" value={detail.prevHash || '无'} mono />
            <MetadataItem label="关键词别名" value={detail.aliasSet || '无'} mono />
            <MetadataItem label="创建者" value={detail.createdBy} />
            <MetadataItem
              label="创建时间"
              value={new Date(detail.createdAt).toLocaleString('zh-CN')}
            />
            {detail.deprecatedAt && (
              <>
                <MetadataItem label="废弃者" value={detail.deprecatedBy || '未知'} />
                <MetadataItem
                  label="废弃时间"
                  value={new Date(detail.deprecatedAt).toLocaleString('zh-CN')}
                />
              </>
            )}
            {detail.archivedAt && (
              <>
                <MetadataItem label="归档者" value={detail.archivedBy || '未知'} />
                <MetadataItem
                  label="归档时间"
                  value={new Date(detail.archivedAt).toLocaleString('zh-CN')}
                />
              </>
            )}
          </div>
        )}

        {activeTab === 'approvals' && (
          <div className="space-y-4">
            {detail.approvals.length === 0 ? (
              <div className="text-center py-8 text-fg-muted dark:text-fg-subtle">
                暂无审批记录
              </div>
            ) : (
              detail.approvals.map((approval) => {
                const decisionInfo = decisionLabels[approval.decision] || {
                  label: approval.decision,
                  color: 'text-fg-muted',
                };
                return (
                  <div
                    key={approval.id}
                    className="border border-border dark:border-gray-700 rounded-lg p-4"
                  >
                    <div className="flex items-center justify-between mb-2">
                      <span className={`font-medium ${decisionInfo.color}`}>
                        {decisionInfo.label}
                      </span>
                      <span className="text-xs text-fg-muted dark:text-fg-muted">
                        {new Date(approval.createdAt).toLocaleString('zh-CN')}
                      </span>
                    </div>
                    <div className="text-sm text-fg-muted dark:text-fg-subtle">
                      审批人: {approval.approverId}
                    </div>
                    {approval.comment && (
                      <div className="mt-2 text-sm text-fg dark:text-gray-300 bg-bg-subtle dark:bg-gray-900 p-2 rounded">
                        {approval.comment}
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function MetadataItem({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="flex items-start justify-between py-2 border-b border-border dark:border-gray-700 last:border-0">
      <span className="text-sm text-fg-muted dark:text-fg-subtle">{label}</span>
      <span
        className={`text-sm text-fg dark:text-white ${mono ? 'font-mono' : ''} max-w-[60%] break-all text-right`}
      >
        {value}
      </span>
    </div>
  );
}
