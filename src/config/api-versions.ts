/**
 * aster-api 端点版本管理
 *
 * 集中管理所有 aster-api 的 REST 端点路径。
 * 修改 API_VERSION 即可切换所有端点的版本前缀。
 */

export const API_VERSION = 'v1';

const prefix = `/api/${API_VERSION}`;

export const API_ENDPOINTS = {
  // 策略评估
  evaluate: `${prefix}/policies/evaluate`,
  evaluateBatch: `${prefix}/policies/evaluate/batch`,
  evaluateSource: `${prefix}/policies/evaluate-source`,
  compile: `${prefix}/policies/compile`,
  schema: `${prefix}/policies/schema`,

  // 健康检查
  healthLive: '/q/health/live',
  healthReady: '/q/health/ready',

  // 审计
  audit: `${prefix}/audit`,

  // Workflow
  workflows: `${prefix}/workflows`,

  // AI Assistant
  aiGenerate: `${prefix}/ai/generate`,
  aiExplain: `${prefix}/ai/explain`,
  aiComplete: `${prefix}/ai/complete`,
} as const;

export type ApiEndpoint = keyof typeof API_ENDPOINTS;
