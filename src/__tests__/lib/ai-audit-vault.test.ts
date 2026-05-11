import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@/lib/prisma', () => ({
  db: { execute: vi.fn() },
}));

import { encryptForAudit, decryptAuditField } from '@/lib/ai-audit-vault';
import { db } from '@/lib/prisma';

describe('ai-audit-vault', () => {
  const originalSecret = process.env.AI_AUDIT_ENCRYPTION_SECRET;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.AI_AUDIT_ENCRYPTION_SECRET = 'test-audit-secret-min-16-chars-len';
  });

  afterEach(() => {
    if (originalSecret === undefined) delete process.env.AI_AUDIT_ENCRYPTION_SECRET;
    else process.env.AI_AUDIT_ENCRYPTION_SECRET = originalSecret;
  });

  describe('encryptForAudit', () => {
    it('null 输入 → 返回 null（不入库）', () => {
      expect(encryptForAudit(null)).toBeNull();
      expect(encryptForAudit(undefined)).toBeNull();
    });

    it('明文 → 返回 SQL 表达式（含 pgp_sym_encrypt）', () => {
      const expr = encryptForAudit('user prompt');
      expect(expr).toBeTruthy();
      // Drizzle SQL chunks: queryChunks 包含 'pgp_sym_encrypt(' 字符串片段
      const serialized = JSON.stringify(expr);
      expect(serialized).toContain('pgp_sym_encrypt');
    });

    it('secret 缺失 → 抛错（防止误存明文）', () => {
      delete process.env.AI_AUDIT_ENCRYPTION_SECRET;
      expect(() => encryptForAudit('x')).toThrow(/AI_AUDIT_ENCRYPTION_SECRET/);
    });

    it('secret 太短 → 抛错', () => {
      process.env.AI_AUDIT_ENCRYPTION_SECRET = 'short';
      expect(() => encryptForAudit('x')).toThrow(/too short/);
    });
  });

  describe('decryptAuditField', () => {
    it('返回 db 解密的明文', async () => {
      vi.mocked(db.execute).mockResolvedValue([{ plain: 'decrypted-text' }] as never);
      const result = await decryptAuditField('encrypted-blob');
      expect(result).toBe('decrypted-text');
    });

    it('空结果 → 返回 null', async () => {
      vi.mocked(db.execute).mockResolvedValue([] as never);
      const result = await decryptAuditField('blob');
      expect(result).toBeNull();
    });
  });
});
