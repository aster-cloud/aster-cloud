import { describe, it, expect } from 'vitest';
import { detectPII } from '@/services/pii/detector';

describe('PIIDetector', () => {
  it('should detect email addresses', () => {
    const result = detectPII('Contact: john@example.com for support');

    expect(result.hasPII).toBe(true);
    expect(result.detectedTypes).toContain('email');
    expect(result.locations[0].match).toContain('@example.com');
  });

  it('should detect phone numbers', () => {
    const result = detectPII('Call me at 555-123-4567 tomorrow');

    expect(result.hasPII).toBe(true);
    expect(result.detectedTypes).toContain('phone');
  });

  it('should detect SSN patterns and flag high risk', () => {
    const result = detectPII('SSN: 123-45-6789');

    expect(result.hasPII).toBe(true);
    expect(result.detectedTypes).toContain('ssn');
    expect(result.riskLevel).toBe('high');
  });

  it('should return clean for non-PII text', () => {
    const result = detectPII('Hello world, nothing sensitive here');

    expect(result.hasPII).toBe(false);
    expect(result.detectedTypes).toHaveLength(0);
  });
});
