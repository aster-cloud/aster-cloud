import { describe, it, expect } from 'vitest';
import {
  upgradeResponse,
  UPGRADE_HTTP_STATUS,
  type UpgradeReason,
} from '@/lib/plan-quota';

describe('plan-quota', () => {
  describe('upgradeResponse', () => {
    it('always sets upgrade=true', () => {
      const r = upgradeResponse('published_rules');
      expect(r.upgrade).toBe(true);
    });

    it('preserves reason verbatim', () => {
      const reasons: UpgradeReason[] = [
        'published_rules',
        'evaluations',
        'audit_retention',
        'sso',
        'data_residency',
        'reviewer_required',
        'team_member_invite',
      ];
      for (const reason of reasons) {
        expect(upgradeResponse(reason).reason).toBe(reason);
      }
    });

    it('recommends enterprise for sso / data_residency / audit_retention', () => {
      expect(upgradeResponse('sso').recommendedPlan).toBe('enterprise');
      expect(upgradeResponse('data_residency').recommendedPlan).toBe('enterprise');
      expect(upgradeResponse('audit_retention').recommendedPlan).toBe('enterprise');
    });

    it('recommends pro for usage / collaboration reasons', () => {
      expect(upgradeResponse('published_rules').recommendedPlan).toBe('pro');
      expect(upgradeResponse('evaluations').recommendedPlan).toBe('pro');
      expect(upgradeResponse('reviewer_required').recommendedPlan).toBe('pro');
      expect(upgradeResponse('team_member_invite').recommendedPlan).toBe('pro');
    });

    it('passes through usage / limit when provided', () => {
      const r = upgradeResponse('published_rules', { usage: 7, limit: 5 });
      expect(r.usage).toBe(7);
      expect(r.limit).toBe(5);
    });

    it('uses default message when not provided', () => {
      const r = upgradeResponse('reviewer_required');
      expect(r.message).toContain('reviewer_required');
    });

    it('respects custom message', () => {
      const r = upgradeResponse('evaluations', { message: 'Custom blurb' });
      expect(r.message).toBe('Custom blurb');
    });
  });

  describe('UPGRADE_HTTP_STATUS', () => {
    it('is 402 Payment Required', () => {
      expect(UPGRADE_HTTP_STATUS).toBe(402);
    });
  });
});
