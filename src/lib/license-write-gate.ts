// requireLicenseWriteOk — route 级 write gate helper。
//
// 用法：在任何 on-prem admin mutate route 顶部调用，503 + 错误 code 拒绝写入
// （UI 端有 read-only banner 同步显示 reason）。

import { NextResponse } from 'next/server';
import { isLicenseReadOnlyGated } from '@/lib/license-runtime-gate';

export interface LicenseWriteGateOptions {
  /**
   * 允许 `grace-expired` reason 通过 gate（用于 license refresh 等
   * 真正的 remediation 路径 —— operator 修复网络后必须能触发 refresh）。
   * 其他 reason（revoked / expired / malformed / missing）仍然阻断。
   */
  allowGraceExpired?: boolean;
}

/**
 * 校验当前部署是否允许 admin mutate 操作。
 * @returns null 表示允许写；NextResponse 表示 503 拒绝。
 */
export async function requireLicenseWriteOk(
  options: LicenseWriteGateOptions = {},
): Promise<NextResponse | null> {
  const gate = await isLicenseReadOnlyGated();
  if (!gate.gated) return null;
  // codex 审查 Major-4：grace-expired 的 remediation 是 refresh 本身
  if (options.allowGraceExpired && gate.reason === 'grace-expired') return null;
  return NextResponse.json(
    {
      error: 'license-read-only-mode',
      reason: gate.reason,
    },
    { status: 503 },
  );
}
