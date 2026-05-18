#!/usr/bin/env bash
#
# Poll the two Vercel/Next.js upstream issues blocking Turbopack-only build.
#
# 我们的 on-prem bundle invariant 依赖 webpack 的 DefinePlugin + alias=false。
# Turbopack 当前没等价物。这个脚本去查上游 PR 的状态，如果都 merged，提示
# "可以启动切换流程"。文档：docs/workstreams/turbopack-migration/README.md。
#
# 用法：
#   scripts/check-turbopack-readiness.sh          # 人工查询，"未就绪"也算成功（exit 0）
#   scripts/check-turbopack-readiness.sh --ci     # CI 模式，"未就绪"才 exit 1（用于
#                                                   未来如果想把"PR 已 merge"作为升级
#                                                   提醒接进定时任务）
#
# 依赖：gh CLI 已认证（`gh auth status` 应为 logged in）。无需仓库 token。
#
# Exit codes（默认 / 人工模式）：
#   0 = 脚本跑成功（无论 PR 是 merged 还是 open）
#   2 = gh CLI 不可用或 API 调用失败
#
# Exit codes（--ci 模式）：
#   0 = 全部 merged → 可以启动切换
#   1 = 至少一个 still open → 继续等
#   2 = gh CLI / API 失败

set -euo pipefail

CI_MODE=false
if [[ "${1:-}" == "--ci" ]]; then
  CI_MODE=true
fi

if ! command -v gh >/dev/null 2>&1; then
  echo "ERROR: gh CLI not found. Install from https://cli.github.com/" >&2
  exit 2
fi

# Issue 1: DefinePlugin 等价（cross-module constants 让 IS_SAAS 参与 DCE）。
# Issue 2: resolveAlias 支持 false（webpack alias=false 的硬阻断等价）。
declare -A PR_TITLES=(
  ["90300"]="Turbopack: cross-module constants  (= DefinePlugin equivalent)"
  ["93331"]="feat(turbopack): support 'false' values for resolveAlias config"
)
PR_NUMBERS=("90300" "93331")

green() { printf '\033[32m%s\033[0m\n' "$*"; }
yellow() { printf '\033[33m%s\033[0m\n' "$*"; }
red() { printf '\033[31m%s\033[0m\n' "$*"; }

echo "Checking Vercel/next.js Turbopack readiness PRs..."
echo

all_merged=true
for n in "${PR_NUMBERS[@]}"; do
  # gh api 直接走 GitHub API；返回 state + merged_at + draft，避免 gh pr view 的
  # 列样式解析脆弱性。
  resp=$(gh api "/repos/vercel/next.js/pulls/${n}" --jq '{state, merged_at, draft}' 2>/dev/null || true)
  if [[ -z "$resp" ]]; then
    red "  #${n}  ✖ failed to fetch (rate limit? offline? gh not auth'd?)"
    all_merged=false
    continue
  fi
  state=$(echo "$resp" | sed -n 's/.*"state":"\([^"]*\)".*/\1/p')
  merged_at=$(echo "$resp" | sed -n 's/.*"merged_at":"\([^"]*\)".*/\1/p')
  draft=$(echo "$resp" | sed -n 's/.*"draft":\(true\|false\).*/\1/p')

  title="${PR_TITLES[$n]}"
  url="https://github.com/vercel/next.js/pull/${n}"

  if [[ -n "$merged_at" && "$merged_at" != "null" ]]; then
    green "  #${n}  ✓ MERGED ${merged_at}"
    echo "         ${title}"
    echo "         ${url}"
  elif [[ "$state" == "open" && "$draft" == "true" ]]; then
    yellow "  #${n}  • open (DRAFT)"
    echo "         ${title}"
    echo "         ${url}"
    all_merged=false
  elif [[ "$state" == "open" ]]; then
    yellow "  #${n}  • open"
    echo "         ${title}"
    echo "         ${url}"
    all_merged=false
  elif [[ "$state" == "closed" ]]; then
    # closed 但未 merged → 上游放弃了，需要人工分析（可能换了另一个方案）
    red "  #${n}  ✖ CLOSED without merge — needs investigation"
    echo "         ${title}"
    echo "         ${url}"
    all_merged=false
  else
    yellow "  #${n}  ? unknown state: ${state}"
    all_merged=false
  fi
  echo
done

if $all_merged; then
  green "All upstream PRs merged. Ready to start Turbopack migration."
  echo
  echo "Next steps (see docs/workstreams/turbopack-migration/README.md):"
  echo "  1. Bump Next.js to a release containing both PRs"
  echo "  2. Remove '--webpack' from dev/build/deploy scripts"
  echo "  3. Migrate next.config.ts webpack hook → turbopack.{define,resolveAlias}"
  echo "  4. Run: rm -rf .next .open-next && DEPLOYMENT_MODE=on-prem pnpm build"
  echo "  5. Run: pnpm verify:on-prem-bundle  (must be 0 leaks)"
  echo "  6. Run: pnpm test:run               (must be 100% pass)"
  exit 0
else
  yellow "Not ready yet. Keep --webpack flag. Re-run this script in ~1 month."
  # 默认人工查询模式：脚本本身跑成功了（已生成报告），exit 0 避免 pnpm 把
  # "尚未就绪"误显示为 ELIFECYCLE Command failed。
  # --ci 模式专给自动化：如果想把"PR 终于 merged"接进定时任务通知，CI 期望
  # "未就绪" exit 非零，这时返 1。
  if $CI_MODE; then
    exit 1
  fi
  exit 0
fi
