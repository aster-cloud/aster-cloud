// SaaS revocation manifest publisher.
//
// 设计意图：
//   - 仅在 SaaS 端运行；on-prem build 不触达此模块
//   - 用 PG sequence 单调分配 version（防止并发 publisher 同 version）
//   - canonical JSON + Ed25519 签名；签名 fn 可注入（vault transit 或 Web Crypto）
//   - 写入 RevocationPublication 表后调用方（如 admin route）负责返回新 version
//
// CRITICAL DESIGN NOTE（签名密钥）：
// 私钥不应离开 Vault/KMS。默认 nodeCryptoSignFn 只用于 dev/staging bootstrap：
// 从 LICENSE_REVOCATION_PRIVATE_KEY_PKCS8 读取 PEM PKCS8 私钥。
// 生产部署必须注入 vaultSignFn（调用 aster-deploy license-signing-api）。
// 本模块从不 log 私钥；signFn 只接收 message bytes，签名后立即返回。

import { asc, sql } from 'drizzle-orm';
import { db, revokedLicenses, revocationPublications } from '@/lib/prisma';
import {
  canonicalizeRevocationDoc,
  type RevocationReason,
  type SignedRevocationDoc,
} from '@/lib/license-revocation';
import {
  setRevocationManifestVersion,
  setRevokedLicensesActive,
} from '@/lib/license-metrics';

export type SignRevocationFn = (message: Uint8Array) => Promise<Uint8Array>;

const DAY_MS = 24 * 60 * 60 * 1000;
const VALID_UNTIL_OFFSET_MS = 7 * DAY_MS;

function bytesToBase64url(bytes: Uint8Array): string {
  return Buffer.from(bytes)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function pemToPkcs8Bytes(pem: string): Uint8Array {
  const body = pem
    .replace(/-----BEGIN PRIVATE KEY-----/g, '')
    .replace(/-----END PRIVATE KEY-----/g, '')
    .replace(/\s+/g, '');
  return new Uint8Array(Buffer.from(body, 'base64'));
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const ab = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(ab).set(bytes);
  return ab;
}

/**
 * Dev/staging 默认 signFn：从 env 读 PEM PKCS8 私钥 + Web Crypto 签名。
 * **生产部署必须注入 vaultSignFn**（aster-deploy license-signing-api）。
 *
 * 生产 fail-closed 守卫（codex 审查 Major-2）：
 *   - NODE_ENV='production' 时拒绝使用此 fn，除非显式设置 LICENSE_ALLOW_LOCAL_SIGNER='1'
 *     （仅用于 emergency 离线 publish，必须立即关掉）
 *   - 这确保 default signer 不会因为 ops 误配置 env 而在生产偷偷启用
 */
export async function nodeCryptoSignFn(message: Uint8Array): Promise<Uint8Array> {
  const isProductionRuntime =
    process.env.NODE_ENV === 'production' &&
    process.env.NEXT_PHASE !== 'phase-production-build';
  if (isProductionRuntime && process.env.LICENSE_ALLOW_LOCAL_SIGNER !== '1') {
    throw new Error(
      'nodeCryptoSignFn 在生产模式下被禁用；请注入 vaultSignFn（license-signing-api）。如需 emergency 离线 publish，临时设置 LICENSE_ALLOW_LOCAL_SIGNER=1 + 在 audit 中记录原因。',
    );
  }
  const pem = process.env.LICENSE_REVOCATION_PRIVATE_KEY_PKCS8;
  if (!pem) {
    throw new Error(
      'LICENSE_REVOCATION_PRIVATE_KEY_PKCS8 is required for default revocation signing (dev/staging only)',
    );
  }
  const key = await crypto.subtle.importKey(
    'pkcs8',
    toArrayBuffer(pemToPkcs8Bytes(pem)),
    { name: 'Ed25519' },
    false,
    ['sign'],
  );
  return new Uint8Array(
    await crypto.subtle.sign('Ed25519', key, toArrayBuffer(message)),
  );
}

async function nextPublicationVersion(): Promise<bigint> {
  const result = await db.execute<{ version: bigint | number }>(sql`
    SELECT nextval('"revocation_publication_version_seq"')::bigint AS "version"
  `);
  const rows = Array.isArray(result)
    ? result
    : (result as { rows?: Array<{ version: bigint | number }> }).rows ?? [];
  const version = rows[0]?.version;
  if (version === undefined || version === null) {
    throw new Error('failed to allocate revocation publication version');
  }
  return BigInt(version);
}

/**
 * 发布新版 signed revocation manifest。
 *
 * 流程：
 *   1. 从 PG sequence 分配下一个单调 version
 *   2. 读取 RevokedLicense 全表（按 revokedAt + licenseId 排序保证 canonical）
 *   3. 构造 unsigned doc → canonicalize → 注入 signFn 签名
 *   4. 写入 RevocationPublication 表（含 signed_doc 全文 + signature）
 *
 * 返回新分配的 version 与 publishedAt，方便 caller 写入 audit log。
 */
export async function publishRevocationManifest(
  opts: {
    now?: Date;
    signFn?: SignRevocationFn;
  } = {},
): Promise<{ version: bigint; publishedAt: Date }> {
  const now = opts.now ?? new Date();
  const version = await nextPublicationVersion();
  // SignedRevocationDoc.version 是 number；超出 safe integer 范围拒绝
  // （long-term 应升级 schema 用 string）
  if (version > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error('revocation publication version exceeds JSON safe integer range');
  }

  const revoked = await db.query.revokedLicenses.findMany({
    orderBy: [asc(revokedLicenses.revokedAt), asc(revokedLicenses.licenseId)],
  });
  const validUntil = new Date(now.getTime() + VALID_UNTIL_OFFSET_MS);
  const unsigned: Omit<SignedRevocationDoc, 'signature'> = {
    schemaVersion: 1,
    version: Number(version),
    publishedAt: now.toISOString(),
    validUntil: validUntil.toISOString(),
    revoked: revoked.map((row) => ({
      licenseId: row.licenseId,
      revokedAt: row.revokedAt.toISOString(),
      reason: row.reason as RevocationReason,
    })),
  };
  const placeholder: SignedRevocationDoc = { ...unsigned, signature: '' };
  const signatureBytes = await (opts.signFn ?? nodeCryptoSignFn)(
    canonicalizeRevocationDoc(placeholder),
  );
  const signature = bytesToBase64url(signatureBytes);
  const signedDoc: SignedRevocationDoc = { ...unsigned, signature };

  await db.insert(revocationPublications).values({
    version,
    publishedAt: now,
    validUntil,
    revokedCount: revoked.length,
    signedDoc: JSON.stringify(signedDoc),
    signature,
  });

  // 暴露 metrics（codex F follow-up）
  setRevokedLicensesActive(revoked.length);
  setRevocationManifestVersion(version);

  return { version, publishedAt: now };
}
