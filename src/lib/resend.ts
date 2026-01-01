import { Resend } from 'resend';

if (!process.env.RESEND_API_KEY) {
  console.warn('RESEND_API_KEY is not set - emails will not be sent');
}

export const resend = process.env.RESEND_API_KEY
  ? new Resend(process.env.RESEND_API_KEY)
  : null;

const FROM_EMAIL = process.env.RESEND_FROM_EMAIL || 'noreply@aster-lang.cloud';
const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://aster-lang.cloud';

// Escape HTML to prevent XSS attacks
function escapeHtml(text: string): string {
  const htmlEscapes: Record<string, string> = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  };
  return text.replace(/[&<>"']/g, (char) => htmlEscapes[char]);
}

// Email templates
export async function sendWelcomeEmail(email: string, name: string) {
  if (!resend) return;

  const safeName = escapeHtml(name);

  await resend.emails.send({
    from: `Aster Cloud <${FROM_EMAIL}>`,
    to: email,
    subject: 'Welcome to Aster Cloud!',
    html: `
      <h1>Welcome to Aster Cloud, ${safeName}!</h1>
      <p>Your 14-day Pro trial has started.</p>
      <p>Start building policies with:</p>
      <ul>
        <li>Unlimited policy executions</li>
        <li>Advanced PII detection</li>
        <li>Compliance reports</li>
      </ul>
      <p><a href="${APP_URL}/dashboard">Go to Dashboard</a></p>
    `,
  });
}

export async function sendTrialExpiringEmail(
  email: string,
  name: string,
  daysLeft: number
) {
  if (!resend) return;

  const safeName = escapeHtml(name);

  await resend.emails.send({
    from: `Aster Cloud <${FROM_EMAIL}>`,
    to: email,
    subject: `Your Pro trial ends in ${daysLeft} day${daysLeft > 1 ? 's' : ''}`,
    html: `
      <h1>Hi ${safeName},</h1>
      <p>Your Pro trial ends in <strong>${daysLeft} day${daysLeft > 1 ? 's' : ''}</strong>.</p>
      <p>After your trial, you'll lose access to:</p>
      <ul>
        <li>Unlimited executions</li>
        <li>Policy sharing</li>
        <li>Compliance reports</li>
        <li>API access</li>
      </ul>
      <p><a href="${APP_URL}/billing">Upgrade Now</a></p>
    `,
  });
}

export async function sendTrialEndedEmail(email: string, name: string) {
  if (!resend) return;

  const safeName = escapeHtml(name);

  await resend.emails.send({
    from: `Aster Cloud <${FROM_EMAIL}>`,
    to: email,
    subject: 'Your Pro trial has ended',
    html: `
      <h1>Hi ${safeName},</h1>
      <p>Your Pro trial has ended and your account has been downgraded to Free.</p>
      <p>You can still use Aster Cloud with limited features, or upgrade anytime.</p>
      <p><a href="${APP_URL}/billing">View Plans</a></p>
    `,
  });
}

export async function sendPasswordResetEmail(email: string, token: string) {
  if (!resend) {
    console.log(`Password reset link: ${APP_URL}/reset-password?token=${token}`);
    return;
  }

  const resetLink = `${APP_URL}/reset-password?token=${token}`;

  await resend.emails.send({
    from: `Aster Cloud <${FROM_EMAIL}>`,
    to: email,
    subject: 'Reset your password',
    html: `
      <h1>Reset your password</h1>
      <p>You requested a password reset for your Aster Cloud account.</p>
      <p>Click the link below to reset your password. This link expires in 1 hour.</p>
      <p><a href="${resetLink}">Reset Password</a></p>
      <p>If you didn't request this, you can safely ignore this email.</p>
    `,
  });
}
