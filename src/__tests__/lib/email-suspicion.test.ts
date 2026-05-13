import { describe, it, expect } from 'vitest';
import { analyzeEmailSuspicion } from '@/lib/email-suspicion';

describe('analyzeEmailSuspicion', () => {
  describe('low recall on real users (no false positives)', () => {
    const realEmails = [
      'ryan.pang@wontlost.com',
      'jane@example.org',
      'alex.fr+work@gmail.com',
      'a@a.io', // short but normal
      'john_doe@company.co.uk',
      'maria.rodriguez@university.edu',
      'support@aster-lang.cloud',
    ];

    for (const email of realEmails) {
      it(`does not flag ${email}`, () => {
        const r = analyzeEmailSuspicion(email);
        expect(r.suspicious).toBe(false);
      });
    }
  });

  describe('high precision on synthetic / bot emails', () => {
    it('flags all-digits local part', () => {
      const r = analyzeEmailSuspicion('1234567890@gmail.com');
      expect(r.signals).toContain('all_digits');
    });

    it('flags base64-like local part (≥16 alphanum)', () => {
      const r = analyzeEmailSuspicion('h7k9p2q4r6s8t1u3@example.com');
      // 16 chars base64-like alone is only 1 signal (suspicious requires ≥2)
      expect(r.signals).toContain('base64_like');
    });

    it('flags long + base64-like as suspicious (≥2 signals)', () => {
      const r = analyzeEmailSuspicion('h7k9p2q4r6s8t1u3v5w7@example.com');
      // 20 chars → long_local + base64_like, 2 signals → suspicious
      expect(r.suspicious).toBe(true);
      expect(r.signals).toContain('long_local');
      expect(r.signals).toContain('base64_like');
    });

    it('flags repeated-char patterns', () => {
      const r = analyzeEmailSuspicion('aaaaaaaaaa@example.com');
      expect(r.signals).toContain('repeated_chars');
    });

    it('flags digit-heavy local parts', () => {
      const r = analyzeEmailSuspicion('user2023841@x.com');
      // 2 digits=7, total=11, ratio=0.636 → digit_heavy
      expect(r.signals).toContain('digit_heavy');
    });

    it('all-digits + long → score ≥ 2 (suspicious)', () => {
      const r = analyzeEmailSuspicion('12345678901234567890@x.com');
      expect(r.suspicious).toBe(true);
      expect(r.signals).toContain('all_digits');
      expect(r.signals).toContain('long_local');
      expect(r.signals).toContain('digit_heavy');
    });
  });

  describe('edge cases', () => {
    it('returns clean for empty / malformed', () => {
      expect(analyzeEmailSuspicion('').suspicious).toBe(false);
      expect(analyzeEmailSuspicion('not-an-email').suspicious).toBe(false);
      expect(analyzeEmailSuspicion('@nodomain').suspicious).toBe(false);
    });

    it('case-insensitive (lowercases local part)', () => {
      const a = analyzeEmailSuspicion('AAAAAAA@x.com');
      expect(a.signals).toContain('repeated_chars');
    });
  });
});
