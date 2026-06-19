import { test, expect } from '@playwright/test';
import { createHmac, randomBytes } from 'node:crypto';

/**
 * 全链路 E2E：管理员禁用某语种 → 语言切换器实时降级（无需登出）。
 *
 * 验证用户场景（两条）：
 *   1. 禁用语言后，页面右上的语言切换器**实时**不再显示该语言（SSE 推送，无刷新）。
 *   2. 被禁语言若为当前语言，页面**即时切回默认英语**（router.replace + toast）。
 *
 * 链路：
 *   admin disable（本测试用 HMAC 直签后端 admin 端点，模拟 cloud BFF）
 *     → aster-api LexiconRegistry.markUnavailable → fireChange
 *     → /api/v1/lexicons/stream SSE 推新快照
 *     → cloud useAvailableLexicons 更新 → LanguageSwitcher intersect 重算
 *     → 下拉去掉该语言 + 当前语言被禁则 redirect 到默认
 *
 * 前提（本地全栈）：
 *   - aster-api 在 LOCAL_API（默认 http://localhost:8080），ASTER_PLAN_GATE_HMAC_KEY
 *     与 E2E_HMAC_KEY 一致
 *   - cloud dev server 在 BASE_CLOUD，其 NEXT_PUBLIC_ASTER_POLICY_API_URL 指向 LOCAL_API
 *   未配齐则 skip（不污染 CI / 生产）。
 *
 * 注意：LanguageSwitcher 挂在**公开 landing 页**（/[locale]），无需登录态——
 * 这正是能跑全链路而不搭 cloud auth 的关键。
 */

const LOCAL_API = process.env.LOCAL_API || 'http://localhost:8080';
const HMAC_KEY = process.env.E2E_HMAC_KEY || 'e2e-local-hmac-secret-key-32chars!!';
const CLOUD = process.env.BASE_CLOUD || 'http://localhost:3000';

// 后端 verifyHmac 的 8 行 canonical（disable/enable 无 body/filename）：
//   method\npath\nts\nnonce\n\n0\n\n
function signAdmin(method: string, path: string) {
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const nonce = randomBytes(16).toString('hex');
  const canonical = `${method}\n${path}\n${timestamp}\n${nonce}\n\n0\n\n`;
  const signature = createHmac('sha256', HMAC_KEY).update(canonical).digest('hex');
  return {
    'X-Aster-Timestamp': timestamp,
    'X-Aster-Nonce': nonce,
    'X-Internal-Signature': signature,
  };
}

async function setLexicon(
  request: import('@playwright/test').APIRequestContext,
  id: string,
  action: 'enable' | 'disable',
) {
  const path = `/api/v1/admin/lexicons/${id}/${action}`;
  const res = await request.post(`${LOCAL_API}${path}`, {
    headers: { ...signAdmin('POST', path), Accept: 'application/json' },
  });
  return res;
}

// 探测本地全栈是否就绪；任一缺失则整组 skip。
let stackReady = false;
let skipReason = '';

test.beforeAll(async ({ request }) => {
  try {
    const api = await request.get(`${LOCAL_API}/api/v1/lexicons`, {
      timeout: 5000,
    });
    if (!api.ok()) {
      skipReason = `aster-api ${LOCAL_API} → HTTP ${api.status()}`;
      return;
    }
    // 确认 HMAC 密钥匹配：enable de-DE 应 200（幂等，确保起始态全开）。
    const probe = await setLexicon(request, 'de-DE', 'enable');
    if (probe.status() === 403) {
      skipReason = 'HMAC key mismatch (set E2E_HMAC_KEY = aster-api ASTER_PLAN_GATE_HMAC_KEY)';
      return;
    }
    const cloud = await request.get(`${CLOUD}/`, { timeout: 8000, maxRedirects: 5 });
    if (!cloud.ok() && (cloud.status() < 300 || cloud.status() >= 400)) {
      skipReason = `cloud dev ${CLOUD} → HTTP ${cloud.status()}`;
      return;
    }
    stackReady = true;
  } catch (e) {
    skipReason = e instanceof Error ? e.message : String(e);
  }
});

test.beforeEach(async ({ request }) => {
  test.skip(!stackReady, `local full-stack not reachable: ${skipReason}`);
  // 每个用例起始：确保 de-DE 启用（上一个用例可能禁用了）。
  await setLexicon(request, 'de-DE', 'enable');
});

test.afterAll(async ({ request }) => {
  // 收尾恢复全开，别给后续测试/手动调试留坑。
  if (stackReady) await setLexicon(request, 'de-DE', 'enable');
});

test.use({ baseURL: CLOUD });

test.describe('Admin disables a language → switcher live-downgrades', () => {
  test('disabled language disappears from the switcher without reload', async ({
    page,
    request,
  }) => {
    // 在英文 landing 上打开（当前语言 en，不会被 disable de 影响重定向）。
    await page.goto('/');
    const select = page.locator('#language-selector');
    await expect(select).toBeVisible();
    // 等 SSE 首帧把 de 选项填进来（后端默认全开）。
    await expect(select.locator('option[value="de"]')).toHaveCount(1, { timeout: 15_000 });

    // 管理员禁用 de-DE（模拟 cloud BFF 调后端）。
    const res = await setLexicon(request, 'de-DE', 'disable');
    expect(res.ok()).toBeTruthy();

    // 不刷新页面：SSE 推送 → 下拉实时去掉 de 选项。
    await expect(select.locator('option[value="de"]')).toHaveCount(0, { timeout: 15_000 });
    // en 仍在（默认语言永不下线）。
    await expect(select.locator('option[value="en"]')).toHaveCount(1);
  });

  test('disabling the CURRENT language redirects the user to English (no logout)', async ({
    page,
    request,
  }) => {
    // 用户正处于德语 landing。
    await page.goto('/de');
    await expect(page).toHaveURL(/\/de(\/|$)/);
    const select = page.locator('#language-selector');
    await expect(select).toBeVisible();
    await expect(select).toHaveValue('de', { timeout: 15_000 });

    // 管理员禁用 de-DE。
    const res = await setLexicon(request, 'de-DE', 'disable');
    expect(res.ok()).toBeTruthy();

    // 即时切回默认英语：URL 离开 /de（落到 bare / 即 en）。
    await expect(page).not.toHaveURL(/\/de(\/|$)/, { timeout: 15_000 });
    // 降级提示 toast（role=status，含"已切回"语义文案）。
    await expect(page.getByRole('status')).toBeVisible({ timeout: 5_000 });
  });
});
