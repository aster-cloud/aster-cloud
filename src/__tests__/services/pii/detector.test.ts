import { describe, it, expect } from 'vitest';
import { detectPII } from '@/services/pii/detector';

describe('PIIDetector', () => {
  describe('基础 PII 类型检测', () => {
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

  describe('扩展 PII 类型检测', () => {
    it('should detect address keywords', () => {
      const result = detectPII('User address: 123 Main Street');

      expect(result.hasPII).toBe(true);
      expect(result.detectedTypes).toContain('address');
    });

    it('should detect name fields', () => {
      const result = detectPII('Enter your first_name and last_name');

      expect(result.hasPII).toBe(true);
      expect(result.detectedTypes).toContain('name');
    });

    it('should detect date of birth', () => {
      const result = detectPII('Please provide your date_of_birth');

      expect(result.hasPII).toBe(true);
      expect(result.detectedTypes).toContain('dob');
    });

    it('should detect credit card and flag high risk', () => {
      const result = detectPII('Enter your credit_card number');

      expect(result.hasPII).toBe(true);
      expect(result.detectedTypes).toContain('credit_card');
      expect(result.riskLevel).toBe('high');
    });

    it('should detect bank account and flag medium risk', () => {
      const result = detectPII('Your bank_account number is required');

      expect(result.hasPII).toBe(true);
      expect(result.detectedTypes).toContain('bank_account');
      expect(result.riskLevel).toBe('medium');
    });

    it('should detect passport and flag medium risk', () => {
      const result = detectPII('Upload your passport for verification');

      expect(result.hasPII).toBe(true);
      expect(result.detectedTypes).toContain('passport');
      expect(result.riskLevel).toBe('medium');
    });

    it('should detect driver license', () => {
      const result = detectPII('Driver license number is needed');

      expect(result.hasPII).toBe(true);
      expect(result.detectedTypes).toContain('driver_license');
    });
  });

  describe('风险级别分类', () => {
    it('should return low risk for name/address only', () => {
      const result = detectPII('Input: full_name, address');

      expect(result.hasPII).toBe(true);
      expect(result.riskLevel).toBe('low');
    });

    it('should return medium risk for passport without high-risk fields', () => {
      const result = detectPII('Upload passport document');

      expect(result.hasPII).toBe(true);
      expect(result.riskLevel).toBe('medium');
    });

    it('should return high risk when SSN is present with other fields', () => {
      const result = detectPII('Collect: email, phone, ssn');

      expect(result.hasPII).toBe(true);
      expect(result.riskLevel).toBe('high');
    });
  });

  describe('边缘情况', () => {
    it('should handle empty string', () => {
      const result = detectPII('');

      expect(result.hasPII).toBe(false);
      expect(result.detectedTypes).toHaveLength(0);
      expect(result.riskLevel).toBe('low');
    });

    it('should handle null-like input', () => {
      // detectPII 内部处理 text || ''
      const result = detectPII(undefined as unknown as string);

      expect(result.hasPII).toBe(false);
    });

    it('should detect multiple PII types in same text', () => {
      const result = detectPII('User: email john@test.com, phone 555-123-4567, ssn');

      expect(result.hasPII).toBe(true);
      expect(result.detectedTypes).toContain('email');
      expect(result.detectedTypes).toContain('phone');
      expect(result.detectedTypes).toContain('ssn');
      expect(result.riskLevel).toBe('high');
    });
  });
});
