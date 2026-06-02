#!/usr/bin/env node
/**
 * Injects docs.sidebar.* labels into messages/{en,zh,de}.json.
 * Reuses the same slugs as sidebar.ts; idempotent (overwrites).
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..', '..');

const LABELS = {
  en: {
    gettingStarted: {
      title: 'Getting Started',
      overview: 'Overview',
      authentication: 'Authentication',
      quickstart: 'Quick Start',
      errors: 'Error Handling',
    },
    apiPolicies: {
      title: 'Policy Evaluation',
      evaluate: 'Evaluate Policy',
      evaluateSource: 'Evaluate Source',
      evaluateJson: 'Evaluate JSON',
      batch: 'Batch Evaluate',
      schema: 'Extract Schema',
      validate: 'Validate Policy',
      versions: 'Version History',
      rollback: 'Rollback',
      cache: 'Cache Management',
    },
    apiWorkflows: {
      title: 'Workflows',
      events: 'Workflow Events',
      state: 'Workflow State',
      metrics: 'Metrics',
    },
    apiAudit: {
      title: 'Audit',
      logs: 'Audit Logs',
      verifyChain: 'Hash Chain Verification',
      versionUsage: 'Version Usage',
      anomalies: 'Anomaly Detection',
      compare: 'Version Comparison',
    },
    apiGraphql: {
      title: 'GraphQL',
      overview: 'Overview',
      queries: 'Queries',
      mutations: 'Mutations',
    },
    apiWebsocket: {
      title: 'WebSocket',
      preview: 'Preview Endpoint',
    },
  },
  zh: {
    gettingStarted: {
      title: '入门',
      overview: '概览',
      authentication: '认证',
      quickstart: '快速开始',
      errors: '错误处理',
    },
    apiPolicies: {
      title: '策略评估',
      evaluate: '评估策略',
      evaluateSource: '评估源代码',
      evaluateJson: '评估 JSON',
      batch: '批量评估',
      schema: '提取 Schema',
      validate: '验证策略',
      versions: '版本历史',
      rollback: '回滚',
      cache: '缓存管理',
    },
    apiWorkflows: {
      title: '工作流',
      events: '工作流事件',
      state: '工作流状态',
      metrics: '指标',
    },
    apiAudit: {
      title: '审计',
      logs: '审计日志',
      verifyChain: '哈希链验证',
      versionUsage: '版本使用',
      anomalies: '异常检测',
      compare: '版本比较',
    },
    apiGraphql: {
      title: 'GraphQL',
      overview: '概览',
      queries: '查询',
      mutations: '变更',
    },
    apiWebsocket: {
      title: 'WebSocket',
      preview: '预览端点',
    },
  },
  de: {
    gettingStarted: {
      title: 'Erste Schritte',
      overview: 'Übersicht',
      authentication: 'Authentifizierung',
      quickstart: 'Schnellstart',
      errors: 'Fehlerbehandlung',
    },
    apiPolicies: {
      title: 'Policy-Evaluierung',
      evaluate: 'Policy Evaluieren',
      evaluateSource: 'Quelle Evaluieren',
      evaluateJson: 'JSON Evaluieren',
      batch: 'Batch-Evaluierung',
      schema: 'Schema Extrahieren',
      validate: 'Policy Validieren',
      versions: 'Versionsverlauf',
      rollback: 'Zurücksetzen',
      cache: 'Cache-Verwaltung',
    },
    apiWorkflows: {
      title: 'Workflows',
      events: 'Workflow-Ereignisse',
      state: 'Workflow-Status',
      metrics: 'Metriken',
    },
    apiAudit: {
      title: 'Audit',
      logs: 'Audit-Logs',
      verifyChain: 'Hash-Kette Verifizieren',
      versionUsage: 'Versionsnutzung',
      anomalies: 'Anomalieerkennung',
      compare: 'Versionsvergleich',
    },
    apiGraphql: {
      title: 'GraphQL',
      overview: 'Übersicht',
      queries: 'Abfragen',
      mutations: 'Mutationen',
    },
    apiWebsocket: {
      title: 'WebSocket',
      preview: 'Preview-Endpoint',
    },
  },
};

for (const locale of ['en', 'zh', 'de']) {
  const path = resolve(ROOT, 'messages', `${locale}.json`);
  const data = JSON.parse(readFileSync(path, 'utf8'));
  data.docs = data.docs || {};
  data.docs.sidebar = data.docs.sidebar || {};
  // Preserve existing keys (ariaLabel, example) then merge fresh.
  Object.assign(data.docs.sidebar, LABELS[locale]);
  writeFileSync(path, JSON.stringify(data, null, 2) + '\n');
  console.log(`[i18n] ${locale}.json updated`);
}
