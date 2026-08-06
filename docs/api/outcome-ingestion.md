# 业务结果回传 API（Outcome Ingestion）

`POST /api/v1/executions/{executionId}/outcome`

平台记录的是「批准 / 拒绝」这个**决策**，但决策事后是否成交、是否坏账，只有你的
业务系统知道。本端点用于把真实结局回传给平台——它是「改一条策略会少赚多少钱」
这类分析的**唯一**数据来源。

> **实现位置**：`src/app/api/v1/executions/[id]/outcome/route.ts`
> 改动该端点的行为时，必须同步更新本文档。

---

## 1. 鉴权

**两种凭据都接受，API Key 优先。**

| 场景 | 凭据 | 说明 |
|---|---|---|
| 客户后台批量回传 | `Authorization: Bearer <API Key>` | **推荐**。决策落地几天后才知道结局，那时早已不是一次浏览器会话 |
| 控制台人工补录/更正 | 登录 Session（Cookie） | 运营人工订正结局是真实需求，不必为此专门建 key |

**判定顺序**（不可颠倒，见 route 的 `resolveCaller`）：

1. 请求带 `Authorization` 头 → 走 API Key 校验。**key 无效直接 401，不回落 Session。**
2. 请求无 `Authorization` 头 → 读 Session。
3. 两者皆无 → 401。

> **为什么 key 无效时不回落**：否则一个拿着过期 key 的后台任务，会因为恰好携带了
> 某个运营的 Cookie 而写入成功，并且写到**那个运营**名下——一次静默的跨身份写入。

### CSRF

`checkCsrf` 对携带 `Authorization: Bearer` 的请求内置放行，故 API Key 调用方
**无需**处理 CSRF。Session 调用方仍受 Origin/Referer 校验保护
（见 `src/lib/security/csrf-gate.ts`）。

### 租户隔离

无论用哪种凭据，都按 `(executionId, callerUserId)` 查询执行记录。
**查不到时返回 404 而非 403**——不泄露「该执行存在但不属于你」。

---

## 2. 请求

```http
POST /api/v1/executions/exec_01H.../outcome
Authorization: Bearer sk_live_...
Content-Type: application/json

{
  "outcome": "converted",
  "value": "12500.0000",
  "occurredAt": "2026-03-14T08:00:00Z",
  "note": "T+3 放款完成"
}
```

| 字段 | 类型 | 必填 | 约束 |
|---|---|---|---|
| `outcome` | string | ✅ | 非空，≤ 64 字符。**词汇由你定义**（`converted` / `defaulted` / `refunded`…），平台不做枚举限制 |
| `value` | number \| string | — | 金额。见下方「3. value 的精度契约」 |
| `occurredAt` | ISO 8601 string | — | **业务发生时间**，不是回传时间。它决定幂等与乱序语义，见「4」 |
| `note` | string | — | 自由备注，超过 1024 字符会被截断（不报错） |

---

## 3. value 的精度契约

数据库列是 `numeric(20,4)`：**整数部分最多 16 位，小数最多 4 位**。

平台在**字符串域**严格校验，不做 `Number()` 隐式转换：

| 输入 | 结果 | 原因 |
|---|---|---|
| `12500`、`"12500.50"`、`-3.5` | ✅ 接受 | |
| `""`、`"   "` | ❌ 400 | `Number("")` 是 `0`，一笔「0 元」比报错糟得多——它会污染估算且事后查不出 |
| `true` / `false` | ❌ 400 | `Number(true)` 是 `1` |
| `[]` / `{}` | ❌ 400 | `Number([])` 是 `0` |
| `"1e20"`、`1e20` | ❌ 400 | 不支持指数记法；且超出列范围时 PostgreSQL 会报 `numeric field overflow` |
| `"12345678901234567"` | ❌ 400 | 整数部分 17 位，超出 |
| `"1.23456"` | ❌ 400 | 小数 5 位，超出 |
| `NaN` / `Infinity` | ❌ 400 | |

> ⚠️ **精度提示**：JS `number` 只有约 16 位有效数字。
> `1234567890123456.1234` 若以 JSON number 传输会被静默截断成
> `1234567890123456`。**大额场景请用字符串传值。**

**这是一次契约收紧**：更早的实现接受上述全部输入并静默转换。如果你的集成依赖
旧的宽松行为，需要在调用侧改为显式传十进制字符串。

---

## 4. 幂等与乱序

一个 execution **只有一个**结局。重复回传是**覆盖**而非追加，且覆盖有条件。

### 规则

设已存记录的业务时间为 `stored`，本次为 `incoming`：

| 情形 | 是否写入 |
|---|---|
| 首次回传 | ✅ |
| `incoming` 晚于 `stored` | ✅ 覆盖 |
| `incoming` **等于** `stored` | ✅ 覆盖（同一业务时间的更正是合法需求） |
| `incoming` 早于 `stored` | ❌ 丢弃（迟到的旧重试不得回滚更正） |
| `stored` 为空、`incoming` 非空 | ✅ 覆盖（新的信息更全） |
| `incoming` 为空 | 仅当 `stored` 也为空时写入 |

设计意图：**乱序重试的危害来自更早的业务时间**。
「A 超时 → B 更正 → A 延迟重试」时，旧 A 不会回滚掉 B。

### `applied`：必须检查

响应总是 `200`，但**不代表一定写入了**：

```json
{ "ok": true, "executionId": "exec_...", "outcome": "converted", "applied": true }
```

```json
{
  "ok": true, "executionId": "exec_...", "outcome": "stale",
  "applied": false,
  "reason": "STALE_OCCURRED_AT",
  "message": "已存在业务时间更新的结局，本次回传未生效"
}
```

**`applied: false` 表示平台判定本次数据已过期并丢弃**。调用方据此决定是否
用更新的 `occurredAt` 重试，而不是假设写入成功。

### 并发（已实测，非推测）

真实 PostgreSQL 下的验证结论：

- **新旧时间并发** → 无论到达顺序，最终都是较新的那条（守卫在竞态下仍确定）
- **10 次并发重复投递** → 只落 1 行（`executionId` 上有 unique 约束）
- **⚠️ 同一业务时间的两条不同更正并发** → **后写者赢，无确定 tie-break**

最后一条是**已知限制**，不是缺陷：单条 upsert 无法为同一业务时间决出确定胜负。
若你的系统会在同一业务时间产生互相冲突的更正，请在调用侧串行化，
或用更精细的 `occurredAt`（毫秒级）区分。

---

## 5. 错误码

| HTTP | code | 含义 |
|---|---|---|
| 400 | `INVALID_JSON` | 请求体不是合法 JSON 对象 |
| 400 | `INVALID_OUTCOME` | `outcome` 为空或超过 64 字符 |
| 400 | `INVALID_VALUE` | `value` 不满足「3」的精度契约 |
| 400 | `INVALID_DATE` | `occurredAt` 不是合法时间 |
| 401 | `UNAUTHORIZED` | 无凭据，或 API Key 无效 |
| 404 | `NOT_FOUND` | 执行记录不存在，**或不属于调用方** |

---

## 6. 已知限制

1. **同业务时间并发无 tie-break**（见「4」）。
2. **无历史版本**：只保留最新结局，覆盖记录仅由 `reportedAt` 留痕，
   不保留被覆盖的旧值。若需完整修订链，需要另建 revision 表——尚未实现。
3. **无批量端点**：当前一次一条。大批量回传需自行并发调用。
