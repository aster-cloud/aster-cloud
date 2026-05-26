// Healthchecks.io 心跳上报。每个 cron 在 runCronOnce 包装器内部调用，
// 由 ops 在 Healthchecks.io 配置 check + 失败告警；本模块只负责"在正确
// 的时刻 ping 正确的 URL"。设计选择如下：
//
//   - 环境变量缺失时静默 no-op。开发环境、on-prem 部署、未编排的 cron 都
//     不需要也不应当强行 ping 外部服务。这一行为是策略，不是 bug。
//   - 网络失败不抛错。一次 ping 失败不应当让 cron 自身被标记失败；
//     uptime 监控本身就是为这种"我们看不见自己"的场景准备的，而且
//     ping 失败的根因往往是网络/DNS，不是 cron 业务逻辑。
//   - 不消费 HTTP 响应。Healthchecks.io 返回 200 / 400 / 404 都不影响我们；
//     如有需要排查，去 healthchecks 仪表板看。
//
// 触发时机：
//   - start    在 cron 抢到 lease 即将运行时。窗口"start"事件让
//              healthchecks 区分"cron 还没启动"和"卡死中"。
//   - success  cron 业务函数成功返回后。
//   - fail     cron 业务函数抛错（任何原因，包括 lease DB 失败）。
//
// 跳过路径（lease 已被其它实例抢走）不发送 ping —— 另一个实例会代发，
// 重复 ping 会让 healthchecks 仪表板看起来像有两个心跳。

/**
 * 心跳事件类型。Healthchecks.io URL 末尾的子路径决定语义：
 *   - 无后缀  → 成功心跳
 *   - /start  → 开始心跳（用于"卡死检测"）
 *   - /fail   → 失败心跳（立即告警）
 */
export type HeartbeatStatus = 'start' | 'success' | 'fail';

/**
 * 上报心跳。
 *
 * @param envName  环境变量名，例如 'HEALTHCHECKS_LICENSE_REVOCATION_URL'。
 *                 该变量的值应为完整的 healthchecks.io URL（不含尾部斜杠）。
 * @param status   事件类型。
 * @param opts.timeoutMs  请求超时，默认 5000。过长会阻塞 cron 完成；
 *                        过短在网络抖动时会丢心跳但不会假阳性。
 *
 * 返回 Promise<void>。永不 reject —— 内部捕获并 console.warn。
 */
export async function recordHealthcheckHeartbeat(
  envName: string,
  status: HeartbeatStatus,
  opts: { timeoutMs?: number } = {},
): Promise<void> {
  const baseUrl = process.env[envName];
  if (!baseUrl) {
    // 静默 no-op —— 见模块头注释。
    return;
  }

  // 末尾不允许斜杠；如果用户配置了带斜杠的 URL，归一化一次。
  const normalized = baseUrl.replace(/\/+$/, '');
  const url =
    status === 'success'
      ? normalized
      : `${normalized}/${status}`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), opts.timeoutMs ?? 5000);
  try {
    await fetch(url, { method: 'POST', signal: controller.signal });
  } catch (err) {
    // 心跳失败不影响 cron。仅记录，不抛。
    console.warn(
      `[healthcheck-heartbeat] ${envName} (${status}) ping failed:`,
      err instanceof Error ? err.message : err,
    );
  } finally {
    clearTimeout(timeout);
  }
}
