/**
 * /renew/<token> — self-serve license renewal entry point.
 *
 * Server-rendered: verify the token before exposing any UI, so an expired
 * or invalid handle never gets the chance to render a checkout button.
 * The token in the URL is the raw form emailed to ops; we hash it
 * server-side and never echo it back into the page.
 *
 * State matrix (mirrors VerifyOutcome):
 *   valid               → show license summary + "Continue to checkout"
 *   not-found           → generic "link invalid" (don't leak whether the
 *                         hash hit any row — anti-enumeration)
 *   expired             → "link expired, contact sales"
 *   already-consumed    → "this link was already used; if you completed
 *                         payment check your email, otherwise contact sales"
 *
 * SaaS-only. on-prem build returns notFound() (the IS_SAAS branch).
 */

import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { IS_SAAS } from '@/lib/deployment-mode';
import { verifyRenewalToken } from '@/lib/renewal-tokens';
import { RenewalPortal } from './renewal-portal';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface Props {
  params: Promise<{ locale: string; token: string }>;
}

export default async function RenewPage({ params }: Props) {
  if (!IS_SAAS) notFound();
  const { token } = await params;
  const outcome = await verifyRenewalToken(token);
  const t = await getTranslations('renewal.portal');

  // 不存在的 token 与过期 token 在 UI 上区分对待：
  //   not-found → 通用 invalid 链接（不暗示是否曾存在）
  //   expired → 明确告知 + 行动指引
  //   already-consumed → 检查邮箱 / 联系销售
  if (outcome.kind === 'not-found') {
    return (
      <ErrorPanel
        title={t('invalid.title')}
        body={t('invalid.body')}
      />
    );
  }
  if (outcome.kind === 'expired') {
    return (
      <ErrorPanel
        title={t('expired.title')}
        body={t('expired.body')}
      />
    );
  }
  if (outcome.kind === 'already-consumed') {
    return (
      <ErrorPanel
        title={t('alreadyConsumed.title')}
        body={t('alreadyConsumed.body')}
      />
    );
  }

  // valid — render client component for Stripe interaction. Pass only the
  // raw token (needed by checkout API) + display info we already have.
  // Raw token is short-lived URL state; not stored client-side beyond
  // this render pass.
  return (
    <RenewalPortal
      rawToken={token}
      licenseId={outcome.row.licenseId}
      customer={outcome.row.customer}
      expiresAt={outcome.row.expiresAt.toISOString()}
      deploymentLabel={
        (outcome.row.oldDeploymentBinding as { deploymentLabel?: string })?.deploymentLabel ??
        outcome.row.licenseId
      }
    />
  );
}

function ErrorPanel({ title, body }: { title: string; body: string }) {
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center gap-6 px-6 py-16 text-center">
      <h1 className="text-2xl font-semibold">{title}</h1>
      <p className="text-fg-muted">{body}</p>
      <a
        href="mailto:sales@aster-lang.cloud"
        className="text-primary hover:underline"
      >
        sales@aster-lang.cloud
      </a>
    </main>
  );
}
