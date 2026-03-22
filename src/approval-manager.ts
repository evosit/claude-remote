/**
 * ApprovalManager — handles pairing code generation and verification for secure session authorization.
 *
 * Security model:
 * - 6-digit numeric code (entropy: 1,000,000)
 * - Code expires after 60 seconds
 * - Single-use: code cleared after successful verification
 * - Rate limiting: max 5 attempts per 10-minute window
 *
 * Thread-safe for single-threaded Node.js event loop.
 */

export class ApprovalManager {
  private sessionId: string;
  private code: string | null = null;
  private codeExpiresAt: number = 0;
  private approvedDiscordUserId: string | null = null;
  private approvedAt: number | null = null;
  private failedAttempts: number = 0;
  private blockExpiresAt: number = 0; // if > now, further attempts blocked

  // Configuration (adjust if needed)
  private static readonly CODE_LENGTH = 6;
  private static readonly CODE_TTL_MS = 60 * 1000; // 60 seconds
  private static readonly RATE_LIMIT_MAX_ATTEMPTS = 5;
  private static readonly RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000; // 10 minutes
  private static readonly BLOCK_DURATION_MS = 10 * 60 * 1000; // 10-minute block

  constructor(sessionId: string) {
    this.sessionId = sessionId;
  }

  /**
   * Generate a new approval code.
   * Replaces any existing pending code.
   */
  generateCode(): string {
    // Reset attempts on new code
    this.failedAttempts = 0;
    this.blockExpiresAt = 0;

    // Generate numeric code with leading zeros
    const min = Math.pow(10, ApprovalManager.CODE_LENGTH - 1); // 100000 for 6 digits
    const max = Math.pow(10, ApprovalManager.CODE_LENGTH) - 1; // 999999
    const codeNum = Math.floor(Math.random() * (max - min + 1)) + min;
    this.code = codeNum.toString().padStart(ApprovalManager.CODE_LENGTH, '0');
    this.codeExpiresAt = Date.now() + ApprovalManager.CODE_TTL_MS;
    return this.code;
  }

  /**
   * Get the current pending code (if any) and its remaining TTL.
   * Used for display/debugging.
   */
  getPendingCode(): string | null {
    if (!this.code) return null;
    if (Date.now() > this.codeExpiresAt) {
      this.code = null;
      return null;
    }
    return this.code;
  }

  /**
   * Get how many ms remain before code expires (0 if expired).
   */
  getCodeTtl(): number {
    if (!this.code) return 0;
    return Math.max(0, this.codeExpiresAt - Date.now());
  }

  /**
   * Verify a provided code against the current pending code.
   * Returns:
   *   - true: success (code valid, approval granted)
   *   - false: failure (wrong code, expired, or blocked)
   *
   * On success, the code is cleared and the Discord user is approved.
   */
  verifyCode(providedCode: string): boolean {
    // Check if currently blocked
    if (Date.now() < this.blockExpiresAt) {
      return false;
    }

    // Check if code exists and not expired
    if (!this.code) {
      this.recordFailure();
      return false;
    }

    if (Date.now() > this.codeExpiresAt) {
      this.code = null;
      this.recordFailure();
      return false;
    }

    // Verify
    if (providedCode === this.code) {
      // Success: clear code, mark approved (to be set by caller with userId)
      this.code = null;
      this.failedAttempts = 0;
      // Note: We don't set approvedDiscordUserId here because we need the Discord userId.
      // The caller should call approveUser() after verifyCode returns true.
      return true;
    } else {
      this.recordFailure();
      return false;
    }
  }

  /**
   * Record a failed attempt and update rate-limit state.
   */
  private recordFailure(): void {
    this.failedAttempts++;
    if (this.failedAttempts >= ApprovalManager.RATE_LIMIT_MAX_ATTEMPTS) {
      this.blockExpiresAt = Date.now() + ApprovalManager.BLOCK_DURATION_MS;
    }
  }

  /**
   * Approve a Discord user for this session.
   * Should be called after verifyCode() returned true, passing the Discord user ID.
   */
  approveUser(discordUserId: string): void {
    this.approvedDiscordUserId = discordUserId;
    this.approvedAt = Date.now();
    // Also clear any remaining state
    this.code = null;
    this.failedAttempts = 0;
    this.blockExpiresAt = 0;
  }

  /**
   * Revoke approval (e.g., on logout or session end).
   */
  revokeApproval(): void {
    this.approvedDiscordUserId = null;
    this.approvedAt = null;
  }

  /**
   * Check if the given Discord user is authorized for this session.
   */
  isApproved(discordUserId: string): boolean {
    // If no approval yet, not approved
    if (!this.approvedDiscordUserId) return false;
    // Check if approval matches
    return this.approvedDiscordUserId === discordUserId;
  }

  /**
   * Get whether there is currently an approved user (any).
   */
  hasApproval(): boolean {
    return this.approvedDiscordUserId !== null;
  }

  /**
   * Get the approved Discord user ID, or null.
   */
  getApprovedUserId(): string | null {
    return this.approvedDiscordUserId;
  }

  /**
   * Get remaining block time in ms, or 0 if not blocked.
   */
  getBlockRemainingMs(): number {
    if (Date.now() >= this.blockExpiresAt) return 0;
    return this.blockExpiresAt - Date.now();
  }

  /**
   * Get the number of remaining attempts before block (0 if blocked).
   */
  getRemainingAttempts(): number {
    if (this.failedAttempts >= ApprovalManager.RATE_LIMIT_MAX_ATTEMPTS) return 0;
    return ApprovalManager.RATE_LIMIT_MAX_ATTEMPTS - this.failedAttempts;
  }

  /**
   * Get current status for debugging.
   */
  getStatus(): {
    hasCode: boolean;
    codeExpired: boolean;
    ttl: number;
    approved: boolean;
    approvedUser: string | null;
    failedAttempts: number;
    blockRemainingMs: number;
  } {
    const now = Date.now();
    const codePresent = this.code !== null;
    const codeExpired = codePresent && now > this.codeExpiresAt;
    const ttl = codePresent ? Math.max(0, this.codeExpiresAt - now) : 0;
    return {
      hasCode: codePresent,
      codeExpired,
      ttl,
      approved: this.hasApproval(),
      approvedUser: this.approvedDiscordUserId,
      failedAttempts: this.failedAttempts,
      blockRemainingMs: this.getBlockRemainingMs(),
    };
  }
}
