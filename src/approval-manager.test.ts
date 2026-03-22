import { describe, it, expect, beforeEach } from 'vitest';
import { ApprovalManager } from './approval-manager.js';

describe('ApprovalManager', () => {
  let manager: ApprovalManager;

  beforeEach(() => {
    manager = new ApprovalManager('test-session');
  });

  describe('generateCode', () => {
    it('should generate a 6-digit numeric code', () => {
      const code = manager.generateCode();
      expect(code).toHaveLength(6);
      expect(/^\d{6}$/.test(code)).toBe(true);
    });

    it('should set expiration to 60 seconds in the future', () => {
      const before = Date.now();
      const code = manager.generateCode();
      const after = Date.now();

      expect(manager['codeExpiresAt']).toBeGreaterThan(before);
      expect(manager['codeExpiresAt']).toBeLessThanOrEqual(after + 60000);
    });

    it('should store the code for verification', () => {
      const code = manager.generateCode();
      expect(manager['code']).toBe(code);
    });

    it('should invalidate previous code when regenerated', () => {
      const code1 = manager.generateCode();
      expect(manager.verifyCode(code1)).toBe(true);

      const code2 = manager.generateCode();
      expect(manager['code']).toBe(code2);
      expect(manager.verifyCode(code1)).toBe(false);
    });
  });

  describe('verifyCode', () => {
    beforeEach(() => {
      manager.generateCode();
    });

    it('should return true for correct code', () => {
      const code = manager['code']!;
      expect(manager.verifyCode(code)).toBe(true);
    });

    it('should return false for incorrect code', () => {
      expect(manager.verifyCode('000000')).toBe(false);
      expect(manager.verifyCode('123456')).toBe(false);
    });

    it('should consume the code after successful verification', () => {
      const code = manager['code']!;
      expect(manager.verifyCode(code)).toBe(true);
      expect(manager['code']).toBeNull();
      expect(manager.verifyCode(code)).toBe(false);
    });

    it('should increment failedAttempts on wrong code', () => {
      expect(manager['failedAttempts']).toBe(0);
      manager.verifyCode('wrong');
      expect(manager['failedAttempts']).toBe(1);
      manager.verifyCode('wrong2');
      expect(manager['failedAttempts']).toBe(2);
    });

    it('should block after 5 failed attempts', () => {
      for (let i = 0; i < 5; i++) {
        expect(manager.verifyCode('wrong')).toBe(false);
      }
      expect(manager['blockExpiresAt']).toBeGreaterThan(Date.now());
      expect(manager.getRemainingAttempts()).toBe(0);

      // Further attempts should still fail
      expect(manager.verifyCode('any')).toBe(false);
    });

    it('should reset failedAttempts when code is verified successfully', () => {
      manager.verifyCode('wrong');
      manager.verifyCode('wrong');
      expect(manager['failedAttempts']).toBe(2);

      const code = manager['code']!;
      expect(manager.verifyCode(code)).toBe(true);
      expect(manager['failedAttempts']).toBe(0);
    });

    it('should return false after code expires', () => {
      // Set expiration to the past
      manager['codeExpiresAt'] = Date.now() - 1000;
      expect(manager.verifyCode(manager['code']!)).toBe(false);
    });
  });

  describe('approveUser', () => {
    it('should store the approved Discord user ID', () => {
      manager.approveUser('12345');
      expect(manager['approvedDiscordUserId']).toBe('12345');
    });
  });

  describe('isApproved', () => {
    it('should return false for unapproved user', () => {
      expect(manager.isApproved('any-user')).toBe(false);
    });

    it('should return true for the approved user', () => {
      manager.approveUser('user-abc');
      expect(manager.isApproved('user-abc')).toBe(true);
    });

    it('should return false for other users', () => {
      manager.approveUser('user-abc');
      expect(manager.isApproved('user-xyz')).toBe(false);
    });

    it('should return false before any user is approved', () => {
      expect(manager.isApproved('some-user')).toBe(false);
    });
  });

  describe('getRemainingAttempts', () => {
    it('should return 5 initially', () => {
      expect(manager.getRemainingAttempts()).toBe(5);
    });

    it('should decrement after failed attempts', () => {
      manager.verifyCode('wrong');
      expect(manager.getRemainingAttempts()).toBe(4);
      manager.verifyCode('wrong');
      expect(manager.getRemainingAttempts()).toBe(3);
    });

    it('should return 0 when blocked', () => {
      for (let i = 0; i < 5; i++) {
        manager.verifyCode('wrong');
      }
      expect(manager.getRemainingAttempts()).toBe(0);
    });

    it('should reset after successful verification', () => {
      // Generate a code first
      manager.generateCode();

      // Two failed attempts
      manager.verifyCode('wrong');
      manager.verifyCode('wrong');
      expect(manager.getRemainingAttempts()).toBe(3);

      // Successful verification resets failedAttempts
      const code = manager['code']!;
      expect(manager.verifyCode(code)).toBe(true);
      expect(manager.getRemainingAttempts()).toBe(5);
    });
  });

  describe('rate limiting', () => {
    it('should block for 10 minutes after exhausting attempts', () => {
      // Exhaust attempts
      for (let i = 0; i < 5; i++) {
        manager.verifyCode('wrong');
      }
      expect(manager['blockExpiresAt']).toBeGreaterThan(Date.now());
      expect(manager['blockExpiresAt']).toBeLessThan(Date.now() + 10 * 60 * 1000 + 1000);
    });
  });
});
