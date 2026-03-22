# Plan: Secure Session Management (P5)

**Milestone**: v2.1 — Security Hardening
**Phase**: 05-secure-session-management
**Estimated Duration**: 3-5 days
**Status**: Ready for Approval

---

## Overview

Implement a pairing-code based authorization system to ensure that only the user with terminal access can activate and control `claude-remote` via Discord.

---

## Task Breakdown

### P5.1: Approval Manager Core (rc.ts)

**Estimated**: 2h

**Changes**:
- Add `ApprovalManager` class inside `rc.ts` (or separate file `src/approval-manager.ts` if code complex)
- Methods:
  - `generateCode(): string` — generates 6-digit random numeric code, sets expiration (now + 60s), resets failedAttempts
  - `verifyCode(code: string): boolean` — checks code, increments failedAttempts on wrong; if valid clears code and marks approved; returns boolean
  - `isApprovedForUser(userId: string): boolean` — checks if given Discord user is the approved one
  - `getApprovalStatus(): { hasApproval: boolean; approvedUser: string | null; expiresIn: number }` — for debugging
  - `clearApproval(): void` — on session restart

**Acceptance**:
- Code format: `######` (6 digits)
- Generated code expires after 60 seconds
- After 5 failed attempts, further attempts blocked for 10 minutes (rate limit)
- Single-use: code cannot be verified twice
- Thread-safe (though rc is single-threaded)

---

### P5.2: RC IPC Methods Expose Approval

**Estimated**: 1h

**Changes to `rc.ts`** (pipe server message handlers):
- Add `msg.type === "generate-approval-code"`:
  - If no pending code or expired, call `approvalManager.generateCode()`
  - Respond `{ code: approvalManager.currentCode }` (masked? maybe show as `***-***`? No, user needs full code; but bot just forwards to ephemeral)
- Add `msg.type === "verify-approval-code"` with `{ code, userId }`:
  - Calls `approvalManager.verifyCode(code)`
  - If valid: sets `approvedDiscordUserId = userId`, responds `{ ok: true }`
  - If invalid: responds `{ ok: false, error: "Invalid or expired code", remainingAttempts: X }`
- Add `msg.type === "check-approved"` with `{ userId }`:
  - Respond `{ approved: approvalManager.isApprovedForUser(userId) }`

**Acceptance**:
- IPC calls work from daemon and slash-commands (via remote-cmd)
- Errors properly reported

---

### P5.3: Display Code on Startup

**Estimated**: 0.5h

**Changes to `rc.ts`** (after daemon enabled):
- When Discord sync is ON (user chose to start with remote), call `approvalManager.generateCode()`
- Print to stderr (or stdout) with clear formatting:
  ```
  ┌─────────────────────────────────────┐
  │  Discord Remote Control             │
  │  Enter this code in Discord to      │
  │  enable remote control:              │
  │                                      │
  │        123456                       │
  │                                      │
  │  Expires in 60 seconds              │
  └─────────────────────────────────────┘
  ```
- Or less fancy: `[INFO] Remote control: go to Discord and enter code: 123456`

**Acceptance**:
- Code visible in terminal when starting
- Clear instruction

---

### P5.4: Modify `/remote on` to Require Code

**Estimated**: 2h

**Changes to `src/slash-commands.ts`**:
- The `/remote` command currently has `on`, `off`, `status` subcommands.
- For `on`:
  - Daemon already exists? Check if already approved for the user: send `check-approved` IPC to RC
    - If approved → proceed as before (already allowed, or re-authorize)
    - If not approved → respond ephemeral: "🔐 Enter the 6-digit code shown in your terminal to activate remote control." Then present modal to collect code.
      - Alternatively, support `/remote on <code>` option: simpler, less UX polish.
  - When code received (via modal submit or option), send `verify-approval-code` to RC.
    - If success: send success reply, daemon sets `lastChannelName` if needed.
    - If failure: send ephemeral error with reason, do not enable.
- For `off` and `status`: also check approval; if not approved, reply with error.

**Acceptance**:
- Unauthorized user cannot enable/disable/check status
- Provided code is verified before enabling
- Duplicate use of same code rejected
- Expired code rejected with "Code expired, please check terminal for new code"
- Too many failures → rate limit error

---

### P5.5: Protect Discord Interactivity (Buttons, Selects)

**Estimated**: 1.5h

**Changes to `src/discord-hook.ts` and any provider interaction handlers**:
- Before executing any interactive action (Allow/Deny buttons, plan choices, text inputs), verify the interaction user is approved.
- This requires IPC call to RC: `check-approved`
- If not approved: respond with ephemeral error and ignore action.

**Acceptance**:
- Buttons from unauthorized users show error and do nothing
- Same for select menus

---

### P5.6: Rate Limiting & Security

**Estimated**: 0.5h

- Maintain `failedAttempts` integer in `ApprovalManager`
- Max 5 attempts; after that, block for 10 minutes (600 seconds)
- On first failure after block, return error "Too many attempts. Wait 10 minutes."
- Expire codes exactly after 60s; reject with "Code expired"

---

### P5.7: Tests (Unit)

**Estimated**: 2h

- Test `ApprovalManager` standalone:
  - Code generation produces 6-digit string
  - Verification succeeds for correct code within TTL
  - Verification fails for wrong code
  - Verification fails after expiry
  - Single-use: second verification fails
  - Rate limit: after 5 failures, subsequent attempts return false with block

---

### P5.8: Integration & UAT

**Estimated**: 2h

- Run full scenario manually (or script):
  1. Start `claude-remote` with Discord enabled
  2. Observe code printed
  3. In Discord:
     - Try `/remote on` with wrong code → fail
     - Try with correct code → success
  4. Send a message → appears in Claude
  5. From another Discord user (or second account): try `/remote on` → fails (already approved? Should fail because approval is per-user)
     - Actually second user should need their own code? They could generate a new code? But RC generates one code. Who does it authorize? The first user who successfully enters it. Second user would need to re-enter code to be approved as well. But we only store one `approvedDiscordUserId`. Should we support multi-user? For now: single-user approval. So only first user who enters code gets control. Once approved, no need for code again. Second user cannot override unless first user calls `/remote off`? That's acceptable. We'll document: only one Discord user can control a session.

- Test that after RC restart, code changes and previous approval is gone.

---

### P5.9: Documentation Updates

**Estimated**: 1h

- Update `README.md`:
  - New section: "Authorization: Entering the pairing code"
  - Screenshots of modal (optional)
  - Explain that only the user who enters the code can control
  - Troubleshooting: "Code expired" error, etc.
- Update `CHANGELOG.md` for v2.1.0? Actually this will be v2.2.0 or v3.0.0.

---

## File Changes Summary

| File | Changes |
|------|---------|
| `src/rc.ts` | Add `ApprovalManager` class; generate code on startup; new IPC types: `generate-approval-code`, `verify-approval-code`, `check-approved` |
| `src/approval-manager.ts` | New file (if extracted) |
| `src/slash-commands.ts` | Require approval for subcommands; handle code verification via modal or argument; show ephemeral prompts |
| `src/discord-hook.ts` (or provider) | Verify approval before processing interactive components |
| `README.md` | Document feature, update screenshots |
| `CHANGELOG.md` | Add entry |

---

## Acceptance Criteria

**Functional**:
- [ ] Pairing code displayed in terminal at startup (when Discord sync enabled)
- [ ] Code is 6 digits, numeric, random
- [ ] Code expires after 60 seconds
- [ ] Code is single-use
- [ ] `/remote on` without code responds with ephemeral error prompting for code
- [ ] `/remote on <code>` works (option)
- [ ] Modal-based code entry works (if implemented)
- [ ] After successful code entry, remote is enabled and user can send messages
- [ ] Unauthorized user cannot enable/disable/query status
- [ ] Buttons/selects from unauthorized users are ignored with ephemeral error
- [ ] Rate limiting: 5 attempts per session, 10-minute block on exceeded
- [ ] Different users can each enter their own code sequentially; first to enter becomes authorized (single-owner model)
- [ ] RC restart clears approval; new code required

**Non-Functional**:
- [ ] No regression in existing functionality for authorized user
- [ ] Clear terminal output for code display
- [ ] Discord interactions respond within 2 seconds (IPC calls are low latency)
- [ ] No code stored in files (memory only)

---

## Verification Checklist

- [ ] Run unit tests for ApprovalManager
- [ ] Manual UAT scenario passes
- [ ] Code review: ensure no bypass paths (e.g., direct pipe client without approval)
- [ ] Security review: entropy, TTL, rate limiting implemented correctly
- [ ] README updated with pairing instructions
- [ ] CHANGELOG entry added

---

## Dependencies & Risks

**Dependencies**:
- Discord.js version supports ephemerals and modals (v14 does)
- No external packages needed

**Risks**:
- Complexity added to interaction flow may confuse users → mitigate with clear instructions
- Modal flow may be clunky on mobile → also support `/remote on <code>` option for fallback
- Ephemeral message timeout (3s limit) for first reply → must reply quickly or defer. We'll design immediate modal presentation.

---

## Rollback Plan

If issues arise:
- The approval check can be gated behind an RC flag (`--no-approval`) to temporarily disable
- Because it's additive and doesn't change core IPC protocol (only adds new checks), it can be toggled

---

## Success Metrics

- Reduce unauthorized `/remote on` attempts to 0 (after release)
- Users report smooth pairing experience (< 30 seconds from startup to active)
- No support tickets about "cannot enable remote" due to confusion

---

**Next**: Once approved, create `05-SUMMARY.md` during execution to record decisions, then implement per tasks.
