#!/usr/bin/env python3
"""Cloudflare WAF 反热链 helper（供 setup-audio-hotlink-waf.sh 调用）。

把所有 JSON 构造/解析逻辑放进独立 Python 文件——不经 shell、不经 heredoc，
彻底避开引号转义与缩进两类坑。子命令由第一个参数决定，读 stdin JSON，写 stdout。

  check_zone      读 zone 详情响应 → 校验 success + name==aster-lang.cloud
  ruleset_id      读 phase entrypoint 响应 → 输出现有 custom ruleset id（无则空）
  rule_payload    输出反热链单条规则的 JSON（block + 允许空 Referer）
  create_payload  读单条规则 JSON → 包成新建 ruleset 的 payload
  confirm         读建规则响应 → 校验 success + 打印命中 /audio/ 的规则详情
"""
import json
import sys

# 反热链表达式：路径含 /audio/ 且 Referer 非空 且 Referer 既不是本站也不是 .dev 域。
# ★允许空 Referer（len>0 才拦）——不误伤隐私设置/播放器/直接访问的正常听众。
AUDIO_EXPR = (
    '(http.request.uri.path contains "/audio/" '
    'and len(http.request.headers["referer"]) > 0 '
    'and not any(http.request.headers["referer"][*] contains "aster-lang.cloud") '
    'and not any(http.request.headers["referer"][*] contains "aster-lang.dev"))'
)
DESC = "Block hotlinking of /audio/* from foreign referrers (allow empty referer)"


def die(msg):
    sys.stderr.write(msg + "\n")
    sys.exit(1)


def main():
    if len(sys.argv) < 2:
        die("usage: cf_waf_helper.py <command>")
    cmd = sys.argv[1]

    if cmd == "check_zone":
        d = json.load(sys.stdin)
        if not d.get("success"):
            die("zone check failed: " + json.dumps(d.get("errors"), ensure_ascii=False))
        name = (d.get("result") or {}).get("name", "")
        if name != "aster-lang.cloud":
            die("zone name mismatch (expected aster-lang.cloud): " + name)
        print(name)

    elif cmd == "ruleset_id":
        d = json.load(sys.stdin)
        print((d.get("result") or {}).get("id", "") if d.get("success") else "")

    elif cmd == "rule_payload":
        print(json.dumps({
            "action": "block",
            "expression": AUDIO_EXPR,
            "description": DESC,
            "enabled": True,
        }))

    elif cmd == "create_payload":
        rule = json.load(sys.stdin)
        print(json.dumps({
            "name": "default",
            "kind": "zone",
            "phase": "http_request_firewall_custom",
            "rules": [rule],
        }))

    elif cmd == "confirm":
        d = json.load(sys.stdin)
        if not d.get("success"):
            die("create rule failed: " + json.dumps(d.get("errors"), ensure_ascii=False))
        rules = (d.get("result") or {}).get("rules") or []
        mine = [x for x in rules if "/audio/" in x.get("expression", "")]
        if not mine:
            die("rule created but not found in response")
        print("OK 规则已生效:")
        for x in mine:
            print("   id      =", x.get("id"))
            print("   action  =", x.get("action"))
            print("   enabled =", x.get("enabled"))
            expr = x.get("expression", "")
            print("   expr    =", (expr[:90] + "…") if len(expr) > 90 else expr)

    else:
        die("unknown command: " + cmd)


if __name__ == "__main__":
    main()
