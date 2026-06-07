# vendor/ — 临时 tarball 应急方案

## 目的

`aster-cloud-aster-lang-ts-0.2.2.tgz` 是 `aster-lang-ts@0.2.2` 的 npm pack 产物，
commit 进 repo 让 `aster-cloud` 能消费 P0-R / P0-R2 / P0-R3 / P0-R4 / P0-R5 修复，
以及 0.2.2 的 typechecker 函数返回类型推断修复（算术 Call + dotted Name 字段访问），
**不依赖 npm registry**。

## 为什么不用 npm publish？

P0-R3/R4 时点 npm token 缺少 `@aster-cloud` org 权限。Token 恢复前用 tarball 桥接。

## 临时 SLA — 删除条件

**当以下三条全部满足时立即删除本目录**：

1. `npm publish @aster-cloud/aster-lang-ts@0.2.1`（或更高版本）成功
2. `aster-cloud/package.json` 改 `file:vendor/...` → `^0.2.1`（或更高版本）
3. `pnpm install --frozen-lockfile && pnpm test` 全绿验证

删除步骤：

```bash
rm -rf vendor/
git rm -r vendor/
# 编辑 package.json：dependencies → "@aster-cloud/aster-lang-ts": "^0.2.1"
pnpm install
pnpm test
git add . && git commit -m "chore(deps): switch to npm-published aster-lang-ts 0.2.1, remove vendor tarball"
```

同时更新 `docs/architecture/decisions/0009-pii-enforcement-default-on.md`
的 "aster-cloud 消费 aster-lang-ts 0.2.1" 节，删除 tarball 描述。

## 反对永久化

- tarball 进 git history 增加 repo 体积（约 1MB / 版本）
- Dependabot / 自动升级不识别 file: 依赖
- 维护者需要手动重新 pack 每次 upstream 更新

**因此本目录必须在 npm publish 凭证可用后 1 周内清理**。Owner: `@aster/lang-stewards`。
