/**
 * Renewal-flow notifications: success email + ops Slack alerts.
 *
 * Why a separate module from src/lib/resend.ts:
 *   The Resend wrapper takes typed payloads for SaaS-side transactional
 *   email (welcome / dunning / billing receipts). Renewal delivery is
 *   structurally different — the body must include both a one-time-display
 *   license key AND a hex string the customer must paste into their env.
 *   The contract is sensitive enough to deserve its own module + test
 *   fixtures rather than be one of N call sites in the generic wrapper.
 *
 * SaaS-only — uses Resend SDK indirectly via lib/resend.ts.
 */

/* @deployment-mode-hot-gate
 * reason: imports lib/resend.ts (Resend SDK) which is gated SaaS-only.
 *         on-prem renewal portal doesn't exist, so this module never
 *         reaches an on-prem bundle. Marker prevents accidental import
 *         from a shared admin page.
 */

import { getResend } from '@/lib/resend';

export interface RenewalInviteEmailInput {
  to?: string;
  customer: string;
  /** Full portal URL with the raw token already appended. */
  portalUrl: string;
  daysRemaining: number;
  /** Current license's expiry — what the email asks the customer to renew before. */
  expiresAt: Date;
  /** Threshold that triggered this email (30 / 14 / 7 / 1) — shown for context. */
  thresholdDays: number;
}

export interface RenewalSuccessEmailInput {
  to?: string;
  customer: string;
  licenseKey: string;
  /** sha256 hex the customer must paste into ASTER_DEPLOYMENT_ID env. */
  deploymentId?: string;
  expiresAt: Date;
  overlapDays: number;
}

/**
 * Send the renewal-invitation email — the one that carries the portal
 * URL when the renewal-warning cron crosses a threshold (30/14/7/1d).
 *
 * Throws if no `to` address available or if Resend isn't configured —
 * cron caller wraps in try/catch + Slack alert so missing email path
 * doesn't black-hole the trigger.
 */
export async function sendRenewalInviteEmail(input: RenewalInviteEmailInput): Promise<void> {
  if (!input.to) {
    throw new Error('[renewal-invite-email] no recipient address available');
  }
  const resend = await getResend();
  if (!resend) {
    throw new Error('[renewal-invite-email] Resend not configured');
  }
  const from = process.env.RENEWAL_EMAIL_FROM ?? 'Aster Licensing <licensing@aster-lang.cloud>';
  const subject =
    input.daysRemaining <= 1
      ? `URGENT: Your Aster license expires in less than a day`
      : `Your Aster license expires in ${input.daysRemaining} days — renew now`;
  await resend.emails.send({
    from,
    to: input.to,
    subject,
    text: renderInviteText(input),
    html: renderInviteHtml(input),
    tags: [
      { name: 'flow', value: 'license-renewal' },
      { name: 'stage', value: 'invite' },
      { name: 'threshold', value: String(input.thresholdDays) },
    ],
  });
}

export async function sendRenewalSuccessEmail(input: RenewalSuccessEmailInput): Promise<void> {
  if (!input.to) {
    throw new Error('[renewal-email] no recipient address available');
  }
  const resend = await getResend();
  if (!resend) {
    // Resend env not configured (dev / staging without keys). Don't pretend
    // we sent; throw so caller's Slack alert path runs and ops know to
    // manually deliver the key from IssuedLicense.
    throw new Error('[renewal-email] Resend not configured; license signed but not delivered');
  }
  const from = process.env.RENEWAL_EMAIL_FROM ?? 'Aster Licensing <licensing@aster-lang.cloud>';
  const subject = `Your Aster license has been renewed`;
  const text = renderTextBody(input);
  const html = renderHtmlBody(input);

  // Use Resend's tagging so we can filter renewal-flow deliveries in
  // Resend dashboard separately from regular SaaS transactional traffic.
  await resend.emails.send({
    from,
    to: input.to,
    subject,
    text,
    html,
    tags: [{ name: 'flow', value: 'license-renewal' }],
  });
}

/**
 * Slack alert for ops. Used by webhook handler when a step needs human
 * follow-up. Failure is swallowed — Slack outage shouldn't fail Stripe
 * webhook processing (the audit is in IssuedLicense regardless).
 */
export async function postRenewalSlackAlert(message: string): Promise<void> {
  const webhook = process.env.LICENSES_SLACK_WEBHOOK;
  if (!webhook) return;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 3000);
  try {
    await fetch(webhook, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ channel: '#licenses-ops', text: message }),
      signal: controller.signal,
    });
  } catch {
    // intentionally swallow
  } finally {
    clearTimeout(timer);
  }
}

// ─────────── Templates ───────────

function renderTextBody(input: RenewalSuccessEmailInput): string {
  return [
    `Hi ${input.customer},`,
    ``,
    `Your Aster Enterprise license has been renewed successfully.`,
    ``,
    `Your new license key (save this somewhere safe — we don't store it):`,
    ``,
    `  ${input.licenseKey}`,
    ``,
    `On-prem env vars to set / update:`,
    ``,
    `  LICENSE_KEY=<the key above>`,
    input.deploymentId
      ? `  ASTER_DEPLOYMENT_ID=${input.deploymentId}`
      : `  ASTER_DEPLOYMENT_ID=<unchanged from previous license>`,
    ``,
    `Next steps:`,
    `  1. Update the env vars in your deployment.`,
    `  2. Restart your aster-cloud instance.`,
    `  3. /admin/license should show "verified" within 60 seconds.`,
    ``,
    `Your previous license key will keep verifying for ${input.overlapDays} days`,
    `so you have time to roll out the new env. After that overlap window it`,
    `will be added to the revocation list automatically.`,
    ``,
    `New expiry: ${input.expiresAt.toISOString().slice(0, 10)}`,
    ``,
    `Questions? Reply to this email or contact support@aster-lang.cloud.`,
    ``,
    `— Aster Licensing`,
  ].join('\n');
}

function renderHtmlBody(input: RenewalSuccessEmailInput): string {
  // Plain, no external CSS — many corporate email clients strip styles
  // and we want the key + deployment-id rendered as monospaced blocks
  // even in those clients.
  const escape = (s: string) =>
    s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return [
    `<p>Hi ${escape(input.customer)},</p>`,
    `<p>Your Aster Enterprise license has been renewed successfully.</p>`,
    `<p><strong>Your new license key</strong> (save this somewhere safe — we don't store it):</p>`,
    `<pre style="font-family: ui-monospace, SFMono-Regular, Menlo, monospace; padding: 12px; background: #f4f4f5; border: 1px solid #d4d4d8; border-radius: 4px; word-break: break-all; white-space: pre-wrap;">${escape(input.licenseKey)}</pre>`,
    `<p><strong>On-prem env vars to set / update:</strong></p>`,
    `<pre style="font-family: ui-monospace, SFMono-Regular, Menlo, monospace; padding: 12px; background: #f4f4f5; border: 1px solid #d4d4d8; border-radius: 4px;">LICENSE_KEY=&lt;the key above&gt;
${input.deploymentId ? `ASTER_DEPLOYMENT_ID=${escape(input.deploymentId)}` : 'ASTER_DEPLOYMENT_ID=&lt;unchanged from previous license&gt;'}</pre>`,
    `<p><strong>Next steps:</strong></p>`,
    `<ol>`,
    `  <li>Update the env vars in your deployment.</li>`,
    `  <li>Restart your aster-cloud instance.</li>`,
    `  <li><code>/admin/license</code> should show "verified" within 60 seconds.</li>`,
    `</ol>`,
    `<p>Your previous license key will keep verifying for <strong>${input.overlapDays} days</strong> so you have time to roll out the new env. After that overlap window it will be added to the revocation list automatically.</p>`,
    `<p><strong>New expiry:</strong> ${escape(input.expiresAt.toISOString().slice(0, 10))}</p>`,
    `<p>Questions? Reply to this email or contact <a href="mailto:support@aster-lang.cloud">support@aster-lang.cloud</a>.</p>`,
    `<p>— Aster Licensing</p>`,
  ].join('\n');
}

// ─────────── Invite (pre-renewal) templates ───────────

function renderInviteText(input: RenewalInviteEmailInput): string {
  const expiryStr = input.expiresAt.toISOString().slice(0, 10);
  const urgency =
    input.daysRemaining <= 1
      ? `Your license expires in less than 24 hours.`
      : `Your license expires in ${input.daysRemaining} days (${expiryStr}).`;
  return [
    `Hi ${input.customer},`,
    ``,
    urgency,
    ``,
    `Renew now via our self-serve portal (one-time payment, no auto-renew):`,
    ``,
    `  ${input.portalUrl}`,
    ``,
    `What happens after you click:`,
    `  1. Confirm the license summary (we re-use your existing tier + deployment binding).`,
    `  2. Pay via Stripe (one-time, per term).`,
    `  3. Receive a follow-up email with the new license key + env vars.`,
    `  4. Update the env on your deployment, restart aster-cloud.`,
    `  5. Your old license keeps verifying for 7 days so you have time to roll out.`,
    ``,
    `This renewal link is valid for 14 days. Need a different tier, multi-license`,
    `renewal, or to change your deployment binding? Contact sales@aster-lang.cloud.`,
    ``,
    `— Aster Licensing`,
  ].join('\n');
}

function renderInviteHtml(input: RenewalInviteEmailInput): string {
  const escape = (s: string) =>
    s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const expiryStr = input.expiresAt.toISOString().slice(0, 10);
  const urgency =
    input.daysRemaining <= 1
      ? `Your license expires in less than 24 hours.`
      : `Your license expires in <strong>${input.daysRemaining} days</strong> (${escape(expiryStr)}).`;
  return [
    `<p>Hi ${escape(input.customer)},</p>`,
    `<p>${urgency}</p>`,
    `<p style="margin: 24px 0;">`,
    `  <a href="${escape(input.portalUrl)}" style="background: #6d28d9; color: #fff; padding: 12px 20px; border-radius: 6px; text-decoration: none; font-weight: 600; font-family: -apple-system, system-ui, sans-serif;">Renew now</a>`,
    `</p>`,
    `<p style="font-size: 12px; color: #6b7280;">Or copy this link: <a href="${escape(input.portalUrl)}">${escape(input.portalUrl)}</a></p>`,
    `<p><strong>What happens after you click:</strong></p>`,
    `<ol>`,
    `  <li>Confirm the license summary (we re-use your existing tier + deployment binding).</li>`,
    `  <li>Pay via Stripe (one-time, per term — no auto-renew).</li>`,
    `  <li>Receive a follow-up email with the new license key + env vars.</li>`,
    `  <li>Update env on your deployment, restart aster-cloud.</li>`,
    `  <li>Your old license keeps verifying for 7 days so you have time to roll out.</li>`,
    `</ol>`,
    `<p style="font-size: 12px; color: #6b7280;">This renewal link is valid for 14 days. Need a different tier, multi-license renewal, or to change your deployment binding? Contact <a href="mailto:sales@aster-lang.cloud">sales@aster-lang.cloud</a>.</p>`,
    `<p>— Aster Licensing</p>`,
  ].join('\n');
}
