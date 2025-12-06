import { Resend } from 'resend';

if (!process.env.RESEND_API_KEY) {
  console.warn('RESEND_API_KEY is not set - emails will not be sent');
}

export const resend = process.env.RESEND_API_KEY
  ? new Resend(process.env.RESEND_API_KEY)
  : null;

const FROM_EMAIL = process.env.RESEND_FROM_EMAIL || 'noreply@aster-lang.cloud';

// Email templates
export async function sendWelcomeEmail(email: string, name: string) {
  if (!resend) return;

  await resend.emails.send({
    from: `Aster Cloud <${FROM_EMAIL}>`,
    to: email,
    subject: 'Welcome to Aster Cloud!',
    html: `
      <h1>Welcome to Aster Cloud, ${name}!</h1>
      <p>Your 14-day Pro trial has started.</p>
      <p>Start building policies with:</p>
      <ul>
        <li>Unlimited policy executions</li>
        <li>Advanced PII detection</li>
        <li>Compliance reports</li>
      </ul>
      <p><a href="https://aster-lang.cloud/dashboard">Go to Dashboard</a></p>
    `,
  });
}

export async function sendTrialExpiringEmail(
  email: string,
  name: string,
  daysLeft: number
) {
  if (!resend) return;

  await resend.emails.send({
    from: `Aster Cloud <${FROM_EMAIL}>`,
    to: email,
    subject: `Your Pro trial ends in ${daysLeft} day${daysLeft > 1 ? 's' : ''}`,
    html: `
      <h1>Hi ${name},</h1>
      <p>Your Pro trial ends in <strong>${daysLeft} day${daysLeft > 1 ? 's' : ''}</strong>.</p>
      <p>After your trial, you'll lose access to:</p>
      <ul>
        <li>Unlimited executions</li>
        <li>Policy sharing</li>
        <li>Compliance reports</li>
        <li>API access</li>
      </ul>
      <p><a href="https://aster-lang.cloud/billing">Upgrade Now</a></p>
    `,
  });
}

export async function sendTrialEndedEmail(email: string, name: string) {
  if (!resend) return;

  await resend.emails.send({
    from: `Aster Cloud <${FROM_EMAIL}>`,
    to: email,
    subject: 'Your Pro trial has ended',
    html: `
      <h1>Hi ${name},</h1>
      <p>Your Pro trial has ended and your account has been downgraded to Free.</p>
      <p>You can still use Aster Cloud with limited features, or upgrade anytime.</p>
      <p><a href="https://aster-lang.cloud/billing">View Plans</a></p>
    `,
  });
}
