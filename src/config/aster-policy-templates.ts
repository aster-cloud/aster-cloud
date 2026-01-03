/**
 * Aster Policy 示例模板
 * 
 * 从 Monaco 编辑器中抽离，避免静态导入导致动态加载失效
 */

export const ASTER_POLICY_TEMPLATES = {
  'en-US': `// Loan Approval Policy
// This policy evaluates loan applications based on credit score and income

This module is finance.loan.

Define Applicant with
  id: Text,
  creditScore: Int,
  income: Float,
  requestedAmount: Float.

To evaluateLoan with applicant: Applicant, produce Text:
  If applicant.creditScore greater than 750:
    Return "Approved with premium rate".
  Otherwise:
    If applicant.creditScore greater than 650:
      Return "Approved with standard rate".
    Otherwise:
      Return "Requires manual review".
`,
  'zh-CN': `// 贷款审批策略
// 此策略根据信用评分和收入评估贷款申请

【模块】金融.贷款。

【定义】申请人 包含
  编号：文本，
  信用评分：整数，
  收入：小数，
  申请金额：小数。

入参 申请人：申请人，产出 文本：
  若 申请人.信用评分 大于 750：
    返回「批准，优惠利率」。
  否则：
    若 申请人.信用评分 大于 650：
      返回「批准，标准利率」。
    否则：
      返回「需要人工审核」。
`,
};

/**
 * 根据 locale 获取对应的模板
 */
export function getTemplateForLocale(locale: string): string {
  const templateKey = locale.startsWith('zh') ? 'zh-CN' : 'en-US';
  return ASTER_POLICY_TEMPLATES[templateKey];
}
