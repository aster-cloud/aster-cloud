#!/usr/bin/env bash
#
# Cloudflare WAF 反热链规则 —— 保护 /audio/* 免被外站盗链。
#
# 用法：./scripts/setup-audio-hotlink-waf.sh
#   交互输入 Cloudflare API Token（需 Zone→WAF→Edit + Zone→Zone→Read 权限）与 Zone ID。
#   凭据只在本脚本内存/你的终端，不落盘、不进 git、不外传。
#
# 做什么：校验 token/zone（只读）→ 查 http_request_firewall_custom ruleset →
#   有则追加规则、无则创建 → 建"/audio/ 且 Referer 非本站且 Referer 非空 → Block"→ 回读确认。
#
# ★允许空 Referer：不误伤隐私设置/播放器/直接访问的正常听众（见 cf_waf_helper.py 注释）。
# ★这只抬门槛：Referer 可伪造，挡不住有意的人；且不阻止"能播放=能下载"。robots/noindex/
#   版权声明由代码侧承担（PR #322）。
set -euo pipefail

read -rsp 'Cloudflare API Token: ' CF_API_TOKEN; echo
read -rp  'Zone ID (aster-lang.cloud): ' CF_ZONE_ID

API="https://api.cloudflare.com/client/v4"
HELPER="python3 $(cd "$(dirname "$0")" && pwd)/cf_waf_helper.py"

auth() {
  curl -s -H "Authorization: Bearer ${CF_API_TOKEN}" -H "Content-Type: application/json" "$@"
}

cleanup() {
  rm -f /tmp/.cf_rule.json /tmp/.cf_create.json
  unset CF_API_TOKEN CF_ZONE_ID
}
trap cleanup EXIT

echo "→ 校验 token 与 zone…"
auth "${API}/zones/${CF_ZONE_ID}" | $HELPER check_zone | sed 's/^/  zone = /'

echo "→ 查 http_request_firewall_custom ruleset…"
RS_ID="$(auth "${API}/zones/${CF_ZONE_ID}/rulesets/phases/http_request_firewall_custom/entrypoint" | $HELPER ruleset_id)"

$HELPER rule_payload > /tmp/.cf_rule.json

if [ -n "$RS_ID" ]; then
  echo "→ 已存在 custom ruleset ($RS_ID)，追加规则…"
  auth -X POST "${API}/zones/${CF_ZONE_ID}/rulesets/${RS_ID}/rules" \
    --data @/tmp/.cf_rule.json | $HELPER confirm
else
  echo "→ 无 custom ruleset，创建并带入规则…"
  $HELPER create_payload < /tmp/.cf_rule.json > /tmp/.cf_create.json
  auth -X POST "${API}/zones/${CF_ZONE_ID}/rulesets" \
    --data @/tmp/.cf_create.json | $HELPER confirm
fi

echo "完成。临时文件与凭据已清除。"
echo
echo "验证（规则生效后跑）："
echo "  外站盗链应被拦：curl -I -H 'Referer: https://evil.example/' https://aster-lang.cloud/audio/guyong-v1.mp3"
echo "  正常访问应 200 ：curl -I https://aster-lang.cloud/audio/guyong-v1.mp3"
