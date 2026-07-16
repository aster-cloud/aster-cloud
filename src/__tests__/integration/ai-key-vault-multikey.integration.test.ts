// 多 key 数据层集成测试（真实 Postgres，testcontainers）。
//
// 覆盖 vault SQL 正确性——这些是 mock 测不到、只有真库才暴露的边界：
//   - saveBYOKKey 多 key：同 provider 反复新增不覆盖，priority 自增（0,1,2…）。
//   - getBYOKCandidatesForInference：按 (priority asc, createdAt asc) 排序；provider 过滤；只 active。
//   - reorderBYOKKeys：CASE 真重排 priority；只动本人；跨 provider 不误伤。
//   - deleteBYOKKey：按 id 精确删；越权别人 id 删不到（deleted=false）。
//   - getDecryptedBYOKKeyById：按 id + userId + active 解密；停用/别人的取不到。
//
// Run: LICENSE_E2E=1 pnpm test:integration
//
// 说明：pgcrypto 加密需 AI_KEY_ENCRYPTION_SECRET；这里在 beforeAll 注入测试密钥。

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { db, aiKeyBindings } from '@/lib/prisma';
import {
  saveBYOKKey,
  getBYOKCandidatesForInference,
  reorderBYOKKeys,
  deleteBYOKKey,
  getDecryptedBYOKKeyById,
} from '@/lib/ai-key-vault';
import { setupTestDb, teardownTestDb } from './setup-postgres';

const U = 'user-mk-1';
const OTHER = 'user-mk-2';
// 满足 vault 对 apiKey 长度的隐含要求（>=20）；后 4 位进 keyHint。
const KEY = (suffix: string) => `sk-integration-test-${suffix}`;

describe.skipIf(process.env.LICENSE_E2E !== '1')('ai-key-vault 多 key（真库）', () => {
  beforeAll(async () => {
    process.env.AI_KEY_ENCRYPTION_SECRET = 'integration-test-secret-key-32chars';
    await setupTestDb();
  });
  afterAll(async () => {
    await teardownTestDb();
  });
  beforeEach(async () => {
    // 每例前清空 AiKeyBinding（不在 setup-postgres 的 TRUNCATE 名单里，单独清）。
    await db.delete(aiKeyBindings);
  });

  it('★同 provider 多次新增不覆盖，priority 自增 0,1,2', async () => {
    const a = await saveBYOKKey({ userId: U, provider: 'openai', apiKey: KEY('a') });
    const b = await saveBYOKKey({ userId: U, provider: 'openai', apiKey: KEY('b') });
    const c = await saveBYOKKey({ userId: U, provider: 'openai', apiKey: KEY('c') });

    const rows = await db.query.aiKeyBindings.findMany({
      where: eq(aiKeyBindings.userId, U),
      columns: { id: true, priority: true },
    });
    // 三行都在（没被 upsert 覆盖）
    expect(rows).toHaveLength(3);
    const byId = Object.fromEntries(rows.map((r) => [r.id, r.priority]));
    expect(byId[a.id]).toBe(0);
    expect(byId[b.id]).toBe(1);
    expect(byId[c.id]).toBe(2);
  });

  it('★不同 provider 各自从 0 起算 priority', async () => {
    await saveBYOKKey({ userId: U, provider: 'openai', apiKey: KEY('o1') });
    const an1 = await saveBYOKKey({ userId: U, provider: 'anthropic', apiKey: KEY('a1') });
    // anthropic 第一个 key priority=0（与 openai 独立计数）
    const row = await db.query.aiKeyBindings.findFirst({
      where: eq(aiKeyBindings.id, an1.id),
      columns: { priority: true },
    });
    expect(row?.priority).toBe(0);
  });

  it('★candidates 按 priority asc 排序，且只含 active', async () => {
    const a = await saveBYOKKey({ userId: U, provider: 'openai', apiKey: KEY('a') });
    const b = await saveBYOKKey({ userId: U, provider: 'openai', apiKey: KEY('b') });
    // 停用 a → candidates 不含它
    await db.update(aiKeyBindings).set({ active: false }).where(eq(aiKeyBindings.id, a.id));

    const cands = await getBYOKCandidatesForInference(U, 'openai');
    expect(cands.map((c) => c.id)).toEqual([b.id]);
  });

  it('★reorder：CASE 真重排 priority（把 b 提到最前）', async () => {
    // 回归锚点：CASE 的 THEN 序号若不 ::int 转型，此调用会抛「column priority is of type
    // integer but expression is of type text」（生产 reorder 500 的根因）。真库跑到即守卫。
    const a = await saveBYOKKey({ userId: U, provider: 'openai', apiKey: KEY('a') }); // pri 0
    const b = await saveBYOKKey({ userId: U, provider: 'openai', apiKey: KEY('b') }); // pri 1
    const updated = await reorderBYOKKeys(U, 'openai', [b.id, a.id]);
    expect(updated).toBe(2);

    const cands = await getBYOKCandidatesForInference(U, 'openai');
    // 现在 b 在前（priority 0），a 在后（priority 1）
    expect(cands.map((c) => c.id)).toEqual([b.id, a.id]);
  });

  it('★reorder 只动本人 + 同 provider：传别人 id 改不到，且 count 反映实际改动行数', async () => {
    const mine = await saveBYOKKey({ userId: U, provider: 'openai', apiKey: KEY('mine') });
    const theirs = await saveBYOKKey({ userId: OTHER, provider: 'openai', apiKey: KEY('theirs') });
    // 试图把别人的 id 混进来重排（传 2 个 id，但只有 mine 属于 U+openai）
    const updated = await reorderBYOKKeys(U, 'openai', [theirs.id, mine.id]);
    // 只改到 1 行（mine）——路由据此 count(1)!=len(2) 判定失败
    expect(updated).toBe(1);

    // 别人的 key priority 不变（仍是 0）
    const theirRow = await db.query.aiKeyBindings.findFirst({
      where: eq(aiKeyBindings.id, theirs.id),
      columns: { priority: true },
    });
    expect(theirRow?.priority).toBe(0);
  });

  it('★reorder 跨 provider id 混入 → 不动别 provider（count 只算同 provider 的）', async () => {
    const o1 = await saveBYOKKey({ userId: U, provider: 'openai', apiKey: KEY('o1') });
    const a1 = await saveBYOKKey({ userId: U, provider: 'anthropic', apiKey: KEY('a1') });
    // 对 openai 组重排，却混入 anthropic 的 id
    const updated = await reorderBYOKKeys(U, 'openai', [a1.id, o1.id]);
    expect(updated).toBe(1); // 只有 o1 属于 openai 组
    // anthropic 的 priority 不被 openai 重排波及
    const aRow = await db.query.aiKeyBindings.findFirst({
      where: eq(aiKeyBindings.id, a1.id),
      columns: { priority: true },
    });
    expect(aRow?.priority).toBe(0);
  });

  it('★delete 按 id 精确删；越权别人 id → deleted=false 不删', async () => {
    const mine = await saveBYOKKey({ userId: U, provider: 'openai', apiKey: KEY('mine') });
    const theirs = await saveBYOKKey({ userId: OTHER, provider: 'openai', apiKey: KEY('theirs') });

    // 越权：U 试图删 OTHER 的 key
    const bad = await deleteBYOKKey(U, theirs.id);
    expect(bad.deleted).toBe(false);
    // 别人的 key 仍在
    const stillThere = await db.query.aiKeyBindings.findFirst({ where: eq(aiKeyBindings.id, theirs.id) });
    expect(stillThere).toBeTruthy();

    // 删自己的 → 成功，返回 provider/keyHint
    const ok = await deleteBYOKKey(U, mine.id);
    expect(ok.deleted).toBe(true);
    expect(ok.provider).toBe('openai');
    expect(ok.keyHint).toBe(KEY('mine').slice(-4));
  });

  it('★decryptById：按 id 取本人明文 key；停用/别人的取不到', async () => {
    const mine = await saveBYOKKey({ userId: U, provider: 'openai', apiKey: KEY('secret') });
    // 本人 active → 拿到明文
    expect(await getDecryptedBYOKKeyById(U, mine.id)).toBe(KEY('secret'));
    // 别人取不到
    expect(await getDecryptedBYOKKeyById(OTHER, mine.id)).toBeNull();
    // 停用后取不到
    await db.update(aiKeyBindings).set({ active: false }).where(eq(aiKeyBindings.id, mine.id));
    expect(await getDecryptedBYOKKeyById(U, mine.id)).toBeNull();
  });
});
