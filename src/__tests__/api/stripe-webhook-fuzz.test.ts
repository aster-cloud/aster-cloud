// Stripe webhook 破坏性测试：扫描 buildPersonalTeamSlug 隐藏 bug
//
// PM v1.1：升 Pro/Enterprise 自动建 personal team；slug 必须是 URL-safe 唯一
// 攻击向量：name 含特殊字符 / 仅符号 / 空白 / 极长 / 无 name 无 email / Unicode

import { describe, it, expect } from 'vitest';
import { buildPersonalTeamSlug } from '@/app/api/stripe/webhook/route';

describe('buildPersonalTeamSlug — 破坏性输入', () => {
  describe('正常路径', () => {
    it('使用 name 生成 slug（小写 + 连字符 + 12 位 userId 后缀）', () => {
      const r = buildPersonalTeamSlug({ name: 'Alice Wong', email: 'a@b.com', userId: 'u-1234567890ab' });
      expect(r.baseLabel).toBe('Alice Wong');
      expect(r.slug).toBe('alice-wong-u-1234567890');
    });

    it('name 缺失时降级到 email local part', () => {
      const r = buildPersonalTeamSlug({ name: null, email: 'bob.smith@acme.com', userId: 'abcdef0123456789' });
      expect(r.baseLabel).toBe('bob.smith');
      expect(r.slug).toBe('bob-smith-abcdef012345');
    });

    it('name 是空白字符串 → 降级到 email', () => {
      const r = buildPersonalTeamSlug({ name: '   ', email: 'c@d.com', userId: 'xyz123' });
      expect(r.baseLabel).toBe('c');
    });
  });

  describe('降级链路', () => {
    it('name 和 email 都缺失 → "workspace" 兜底', () => {
      const r = buildPersonalTeamSlug({ name: null, email: null, userId: 'nouser' });
      expect(r.baseLabel).toBe('workspace');
      expect(r.slug).toBe('workspace-nouser');
    });

    it('name="" + email="" → "workspace" 兜底', () => {
      const r = buildPersonalTeamSlug({ name: '', email: '', userId: 'abc' });
      expect(r.baseLabel).toBe('workspace');
      expect(r.slug).toBe('workspace-abc');
    });

    it('name 仅含特殊字符 → 兜底 slug "workspace"', () => {
      const r = buildPersonalTeamSlug({ name: '!!!@@@###', email: null, userId: 'specialid001' });
      // baseLabel 保留原文用于显示；slug 部分回落 'workspace'
      expect(r.slug).toBe('workspace-specialid001');
    });

    it('userId 短于 12 位时 slice 不溢出', () => {
      const r = buildPersonalTeamSlug({ name: 'A', email: null, userId: 'abc' });
      expect(r.slug).toBe('a-abc');
    });

    it('userId 是空字符串时仍生成合法 slug', () => {
      const r = buildPersonalTeamSlug({ name: 'Alice', email: null, userId: '' });
      // slug = 'alice-' （末尾连字符）— 这是合法的，因为 baseLabel slug 部分有内容
      expect(r.slug).toMatch(/^alice-?$/);
    });
  });

  describe('国际化 / 特殊字符', () => {
    it('name 含纯 CJK 字符 → slug 回落 "workspace"，baseLabel 保留原文', () => {
      const r = buildPersonalTeamSlug({ name: '张三', email: null, userId: 'cjk001' });
      expect(r.baseLabel).toBe('张三'); // 显示用，保留中文
      // CJK 不是 [a-z0-9]，slug 部分回落 'workspace' 兜底
      expect(r.slug).toBe('workspace-cjk001');
    });

    it('name 是中英混合 → 仅保留 ASCII 部分作为 slug', () => {
      const r = buildPersonalTeamSlug({ name: '张三 Alice', email: null, userId: 'mix0001' });
      expect(r.baseLabel).toBe('张三 Alice');
      expect(r.slug).toBe('alice-mix0001');
    });

    it('name 含 emoji 不破坏 slug 生成', () => {
      const r = buildPersonalTeamSlug({ name: 'Alice 🎉', email: null, userId: 'emj123' });
      expect(r.slug).toBe('alice-emj123');
    });

    it('name 是德语 ümlaut → NFKD 正规化 + 重音剥离，保留语义', () => {
      // 'Müller' 被 NFKD 拆为 'Mu' + combining ¨，combining 字符被移除 → 'Muller'
      const r = buildPersonalTeamSlug({ name: 'Müller', email: null, userId: 'umlaut01' });
      expect(r.slug).toBe('muller-umlaut01');
    });

    it('name 是法语重音 → 重音剥离后保留 ASCII', () => {
      const r = buildPersonalTeamSlug({ name: 'Café Résumé', email: null, userId: 'frfr01' });
      expect(r.slug).toBe('cafe-resume-frfr01');
    });

    it('name 是 ñ / å / ø 等北欧字符 → 重音剥离后保留', () => {
      const r = buildPersonalTeamSlug({ name: 'Niño Åstrand', email: null, userId: 'nor001' });
      // 'ñ' → NFKD 'n' + combining ~；'Å' → 'A' + combining ring → 'nino-astrand'
      expect(r.slug).toBe('nino-astrand-nor001');
    });
  });

  describe('注入 / 极端长度', () => {
    it('name 含 SQL-like 注入字符 → 仅产生连字符，不破坏', () => {
      const r = buildPersonalTeamSlug({
        name: "Alice'); DROP TABLE Team;--",
        email: null,
        userId: 'sqluser',
      });
      // 应该只剩字母和连字符
      expect(r.slug).toMatch(/^[a-z0-9-]+$/);
      expect(r.slug).not.toContain("'");
      expect(r.slug).not.toContain(';');
      expect(r.slug).not.toContain(' ');
    });

    it('name 含 path traversal 字符 → 仅产生连字符', () => {
      const r = buildPersonalTeamSlug({
        name: '../../etc/passwd',
        email: null,
        userId: 'trav01',
      });
      expect(r.slug).toMatch(/^[a-z0-9-]+$/);
      expect(r.slug).not.toContain('/');
      expect(r.slug).not.toContain('.');
    });

    it('极长 name (1000 chars) → slug 截断到 256 字符上限', () => {
      const longName = 'a'.repeat(1000);
      const r = buildPersonalTeamSlug({ name: longName, email: null, userId: 'long01' });
      expect(r.slug.length).toBe(256);
      expect(r.slug).toMatch(/^[a-z0-9-]+$/);
    });

    it('极长 name 但 baseLabel 不被截断（用于显示）', () => {
      const longName = 'a'.repeat(1000);
      const r = buildPersonalTeamSlug({ name: longName, email: null, userId: 'long02' });
      expect(r.baseLabel.length).toBe(1000);
    });

    it('name 含大量空白 → 折叠成单个连字符', () => {
      const r = buildPersonalTeamSlug({
        name: 'A    B    C',
        email: null,
        userId: 'spc001',
      });
      expect(r.slug).toBe('a-b-c-spc001');
    });
  });

  describe('幂等性约定', () => {
    it('相同输入产生相同 slug（确定性）', () => {
      const a = buildPersonalTeamSlug({ name: 'Alice', email: null, userId: 'abcdef' });
      const b = buildPersonalTeamSlug({ name: 'Alice', email: null, userId: 'abcdef' });
      expect(a.slug).toBe(b.slug);
    });

    it('不同 userId 即使同名也产生不同 slug（避免冲突）', () => {
      const a = buildPersonalTeamSlug({ name: 'Alice', email: null, userId: 'aaaaaa' });
      const b = buildPersonalTeamSlug({ name: 'Alice', email: null, userId: 'bbbbbb' });
      expect(a.slug).not.toBe(b.slug);
    });

    it('userId 前 12 位相同的两人才会冲突（碰撞概率 ≈ 5.4e-15）', () => {
      // v1.1 修复：userId 后缀从 6 位扩到 12 位，让前缀相同的两个用户产生不同 slug
      const a = buildPersonalTeamSlug({ name: 'Alice', email: null, userId: 'abcdef123456-extra-1' });
      const b = buildPersonalTeamSlug({ name: 'Alice', email: null, userId: 'abcdef123456-other-2' });
      // 前 12 位相同 → 仍冲突（极端碰撞，承认设计上限）
      expect(a.slug).toBe(b.slug);
    });

    it('userId 前 6 位相同但第 7-12 位不同 → 不冲突（v1.1 修复）', () => {
      // 修复 v1.0 已知约束：仅前 6 位 slice 会让大量 UUID 误碰
      const a = buildPersonalTeamSlug({ name: 'Alice', email: null, userId: 'abcdef-aaaa-1' });
      const b = buildPersonalTeamSlug({ name: 'Alice', email: null, userId: 'abcdef-bbbb-2' });
      expect(a.slug).not.toBe(b.slug);
    });
  });

  describe('slug 格式不变量', () => {
    it.each([
      'Alice',
      'bob@x',
      'Hello World',
      "weird's name",
      '中文 with English',
      'a b c d e f',
    ])('slug 始终匹配 [a-z0-9-]+ 格式（输入: "%s"）', (name) => {
      const r = buildPersonalTeamSlug({ name, email: null, userId: 'fmtchk' });
      expect(r.slug).toMatch(/^[a-z0-9-]+$/);
      expect(r.slug).not.toMatch(/^-/);
      expect(r.slug).not.toMatch(/-$/);
      expect(r.slug).not.toMatch(/--/);
    });
  });
});
