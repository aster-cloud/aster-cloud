// renewal-delivery email module tests.
//
// Strategy: mock @/lib/resend so we don't hit Resend API; assert the
// payload we'd send (from, to, subject, key strings present in both
// text + html bodies). Tags also asserted because they're the way
// ops filter renewal traffic in Resend dashboard.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockSend = vi.fn(async () => ({ data: { id: 'mock-email-id' }, error: null }));

vi.mock('@/lib/resend', () => ({
  getResend: vi.fn(async () => ({ emails: { send: mockSend } })),
}));

import { getResend } from '@/lib/resend';
import {
  sendRenewalInviteEmail,
  sendRenewalSuccessEmail,
} from '@/lib/emails/renewal-delivery';

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('sendRenewalInviteEmail', () => {
  it('sends with portal URL + days remaining in body, tags renewal:invite', async () => {
    await sendRenewalInviteEmail({
      to: 'ops@acme.example',
      customer: 'Acme Corp',
      portalUrl: 'https://aster-lang.cloud/renew/abc123',
      daysRemaining: 14,
      expiresAt: new Date('2026-06-01T00:00:00Z'),
      thresholdDays: 14,
    });
    expect(mockSend).toHaveBeenCalledOnce();
    const call = mockSend.mock.calls[0][0] as {
      to: string;
      subject: string;
      text: string;
      html: string;
      tags: Array<{ name: string; value: string }>;
    };
    expect(call.to).toBe('ops@acme.example');
    expect(call.subject).toContain('14');
    expect(call.text).toContain('https://aster-lang.cloud/renew/abc123');
    expect(call.text).toContain('Acme Corp');
    expect(call.text).toContain('14 days');
    expect(call.html).toContain('https://aster-lang.cloud/renew/abc123');
    expect(call.tags).toEqual(
      expect.arrayContaining([
        { name: 'flow', value: 'license-renewal' },
        { name: 'stage', value: 'invite' },
        { name: 'threshold', value: '14' },
      ]),
    );
  });

  it('uses URGENT subject when daysRemaining <= 1', async () => {
    await sendRenewalInviteEmail({
      to: 'x@y.z',
      customer: 'C',
      portalUrl: 'https://p.test/renew/x',
      daysRemaining: 1,
      expiresAt: new Date('2026-05-20T00:00:00Z'),
      thresholdDays: 1,
    });
    const subject = (mockSend.mock.calls[0][0] as { subject: string }).subject;
    expect(subject).toContain('URGENT');
  });

  it('throws when recipient missing — caller logs + falls back to Slack', async () => {
    await expect(
      sendRenewalInviteEmail({
        customer: 'C',
        portalUrl: 'https://p.test/renew/x',
        daysRemaining: 7,
        expiresAt: new Date('2026-05-26T00:00:00Z'),
        thresholdDays: 7,
      }),
    ).rejects.toThrow(/no recipient/);
  });

  it('throws when Resend not configured (getResend returns null)', async () => {
    (getResend as unknown as { mockResolvedValueOnce: (v: unknown) => void }).mockResolvedValueOnce(null);
    await expect(
      sendRenewalInviteEmail({
        to: 'x@y.z',
        customer: 'C',
        portalUrl: 'https://p.test/renew/x',
        daysRemaining: 7,
        expiresAt: new Date('2026-05-26T00:00:00Z'),
        thresholdDays: 7,
      }),
    ).rejects.toThrow(/Resend not configured/);
  });

  it('escapes user-provided customer name in HTML body', async () => {
    await sendRenewalInviteEmail({
      to: 'x@y.z',
      customer: '<script>alert(1)</script>',
      portalUrl: 'https://p.test/renew/x',
      daysRemaining: 7,
      expiresAt: new Date('2026-05-26T00:00:00Z'),
      thresholdDays: 7,
    });
    const html = (mockSend.mock.calls[0][0] as { html: string }).html;
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });
});

describe('sendRenewalSuccessEmail', () => {
  it('embeds license key + deploymentId + overlap notice', async () => {
    await sendRenewalSuccessEmail({
      to: 'ops@acme.example',
      customer: 'Acme Corp',
      licenseKey: 'aster-ent-v2-lic-2026-x.sig',
      deploymentId: 'a'.repeat(64),
      expiresAt: new Date('2027-05-19T00:00:00Z'),
      overlapDays: 7,
    });
    const call = mockSend.mock.calls[0][0] as { text: string; html: string };
    expect(call.text).toContain('aster-ent-v2-lic-2026-x.sig');
    expect(call.text).toContain('a'.repeat(64));
    expect(call.text).toContain('7 days');
    expect(call.html).toContain('aster-ent-v2-lic-2026-x.sig');
  });

  it('handles missing deploymentId gracefully', async () => {
    await sendRenewalSuccessEmail({
      to: 'x@y.z',
      customer: 'C',
      licenseKey: 'aster-ent-v2-k.s',
      expiresAt: new Date('2027-05-19T00:00:00Z'),
      overlapDays: 7,
    });
    const text = (mockSend.mock.calls[0][0] as { text: string }).text;
    expect(text).toContain('unchanged from previous license');
  });
});
