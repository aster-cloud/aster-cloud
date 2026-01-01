import { describe, it, expect } from 'vitest';
import { PLANS, getPlanConfig, getPlanLimit, canAccessApiKeys } from '@/lib/plans';

describe('Plans Configuration', () => {
  it('should have all required plans', () => {
    expect(PLANS).toHaveProperty('free');
    expect(PLANS).toHaveProperty('trial');
    expect(PLANS).toHaveProperty('pro');
    expect(PLANS).toHaveProperty('team');
    expect(PLANS).toHaveProperty('enterprise');
  });

  it('should return correct limits', () => {
    expect(getPlanLimit('free', 'policies')).toBe(3);
    expect(getPlanLimit('pro', 'executions')).toBe(5000);
  });

  it('should correctly identify API key access', () => {
    expect(canAccessApiKeys('free')).toBe(false);
    expect(canAccessApiKeys('pro')).toBe(true);
    expect(canAccessApiKeys('team')).toBe(true);
  });

  it('should expose plan capabilities via getPlanConfig', () => {
    const proConfig = getPlanConfig('pro');

    expect(proConfig.capabilities.apiAccess).toBe(true);
    expect(proConfig.capabilities.teamFeatures).toBe(false);
  });
});
