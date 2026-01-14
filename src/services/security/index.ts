/**
 * 安全服务模块
 *
 * 提供策略执行的安全保障：
 * - 哈希与签名验证
 * - Nonce 防重放攻击
 * - 安全事件审计
 * - 安全执行器
 */

// 哈希与签名服务
export {
  computeSourceHash,
  computeChainedHash,
  signRequest,
  verifySignature,
  validateTimestamp,
  isValidHashFormat,
  isValidSignatureFormat,
  type SignedRequest,
  type SignaturePayload,
} from './policy-security';

// Nonce 服务
export {
  checkAndRecordNonce,
  cleanupExpiredNonces,
  getNonceStats,
  type NonceCheckResult,
} from './nonce-service';

// 安全事件服务
export {
  logSecurityEvent,
  logSecurityEventsBatch,
  getSecurityEvents,
  getSecurityEventStats,
  cleanupOldSecurityEvents,
  type SecurityEventData,
  type SecurityEventQueryOptions,
} from './security-event-service';

// 安全执行器
export {
  executeSecurely,
  getExecutableVersions,
  getDefaultVersionInfo,
  type SecureExecuteOptions,
  type SecureExecuteResult,
  type SecurityErrorCode,
} from './secure-executor';
