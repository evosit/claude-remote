# Phase: Secure Session Management (P5)

**Milestone**: v2.1 — Security Hardening
**Start date**: 2026-03-22
**Estimated duration**: 3-5 days
**Status**: Planning

---

## Context & Problem Statement

The Discord bot for `claude-remote` is a **public bot**—any Discord user can add it to their server. Currently, the `/remote on` slash command is unrestricted: any user in a channel where the bot is present can enable remote control for that channel. This creates a **security vulnerability**:

- An attacker could add the bot to their own server
- They could type `/remote on` and gain control over a `claude-remote` session that is still connected to a channel
- If multiple `claude` sessions are running (one with `claude-remote`, one without), and the `claude-remote` daemon auto-restarts (bug we just fixed) or if environment variables are shared, there is potential for session hijacking or interference

**Goal**: Ensure that only the user who started `claude-remote` in a terminal can authorize remote control from Discord. Discord-side activation requires explicit terminal-side approval.

---

## Phase Objectives

1. Implement a **pairing code flow**: Terminal generates a short-lived code; Discord user must enter it to activate remote control.
2. **Restrict slash commands**: `/remote on`, `/remote off`, `/remote status`, etc. require either:
   - Recent approval code verified within time window, OR
   - Ephemeral approval already granted for this session
3. **Bind session to Discord user**: When remote is approved, the Discord user who entered the code is authorized for the session duration.
4. **Clear UX**: Terminal shows clear instructions; Discord bot gives helpful error messages when unauthorized.

---

## Research Requirements (P5.1)

Before implementation, we need to understand:

- **Discord.js capabilities**:
  - Can slash commands receive an interactive modal input? (Yes, through ephemeral responses or follow-up)
  - How to send ephemeral messages visible only to the command user?
  - How to fetch the Discord user ID from an interaction?

- **Security patterns**:
  - Optimal pairing code length and TTL
  - Where to store pending approvals securely (in-memory vs temp file)
  - How to bind a pending code to a specific RC session (sessionId)
  - Prevent replay attacks (code should be single-use)

**Deliverable**: `05-RESEARCH.md` documenting:
- Discord.js API references
- Interaction flow diagram
- Data structures for pending approvals
- Security considerations (code entropy, brute-force protection, timeouts)

---

## Plan Development (P5.2)

Create `05-PLAN.md` with:

- Task breakdown (subtasks with estimates)
- File changes map:
  - `rc.ts`: generate approval codes, store in memory, expose IPC to verify
  - `slash-commands.ts`: intercept `/remote on` and others, require approval
  - `daemon.ts`: (maybe) support for ephemeral messages
  - New file: `src/approval-manager.ts` (temporary pending approvals)
  - New file: `src/pairing-flow.ts` (terminal instructions, code generation)
- Acceptance criteria per task
- Verification checklist

---

## Implementation (P5.3-P5.5)

Approximate tasks:

### P5.3: Approval Manager & RC IPC

- Add `ApprovalManager` class:
  - `generateCode(sessionId): string`
  - `verifyCode(sessionId, code): boolean` (single-use, 60s TTL)
  - `isApproved(sessionId, discordUserId): boolean`
  - `approveSession(sessionId, discordUserId)`
- Add IPC methods in `rc.ts`:
  - `generate-approval-code`
  - `verify-approval-code`
  - `approve-session`
- Display code in terminal when `claude-remote` starts with Discord sync enabled: `[INFO] Remote control: visit Discord and enter this code: 123456`

### P5.4: Slash Command Authorization

- Modify `/remote on` handler in `slash-commands.ts`:
  - If daemon responds with status `active` and session has approved user already → allow (re-authorize)
  - Else → respond with ephemeral message: "Enter the code from your terminal" and open modal OR require user to use `/remote on <code>` as argument
  - When code provided → send to RC via IPC → verify → if success, approve session
- For `/remote off`, `/remote status`, ensure they also check approval (except maybe `/remote status` can show "ON (awaiting approval)" etc.)

### P5.5: Terminal UX Integration

- When `claude-remote` starts and detects Discord sync enabled (daemon created or about to create), print pairing code to stdout
- Add `--no-approval` or config flag to skip (for trusted environments)? Optional.
- Handle `/remote on` feedback: terminal may show "Remote control authorized for Discord user @X"

---

## Testing & Verification (P5.6)

**Unit tests**: ApprovalManager logic (code generation, TTL expiry, single-use)

**Integration tests**:
- Simulate `/remote on` without code → denied
- Provide code → approved
- Second use of same code → denied
- Expired code → denied
- Different sessionId → denied

**Manual UAT**:
1. Start `claude-remote`
2. Note code displayed
3. In Discord, type `/remote on` with wrong code → see error
4. Enter correct code → see success
5. Verify only this user can send messages that reach Claude
6. Start second `claude-remote` instance; verify codes are independent
7. Exit and restart; verify new code generated

---

## Acceptance Criteria

- [ ] Pairing code (6 digits) displayed in terminal on startup when Discord sync is enabled
- [ ] Code expires after 60 seconds (configurable?)
- [ ] Code is single-use
- [ ] `/remote on` requires authorization code (via modal or `/remote on <code>`)
- [ ] Unauthorized attempts get clear error message: "Enter the code shown in your terminal to activate remote control"
- [ ] Once authorized, Discord user can fully interact for session lifetime
- [ ] If daemon dies and restarts (hot-reload), existing approval persists
- [ ] If RC process exits and restarts, new code generated
- [ ] No way to bypass approval (e.g., by setting env vars) from Discord side
- [ ] Terminal clearly shows: "Remote control authorized for @username in channel #xyz"

---

## Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Race condition: code used at exact moment TTL expires | User frustrated | Allow small clock skew (2 sec); if expired, prompt for new code |
| Terminal code not visible (e.g., logs suppress output) | Session deadlocked | Print code to stderr? Also allow `--show-code` flag to force display |
| Bot in multiple servers: user from Server A enters code for session in Server B | Cross-server auth | Bind approval to `(sessionId, discordUserId)` only; allow any server that has the channel? Actually channel is per-session; only that channel's messages route to that session. So fine. |
| Attacker brute-forces 6-digit code (1 in 1,000,000) | Unauthorized access | Rate limit attempts (max 5 tries per 10 min) in ApprovalManager |
| Code leakage in logs or screenshots | Unauthorized use | Keep entropy high; 6 digits gives ~20 bits; acceptable for low-risk. Could support longer alphanumeric codes if needed. |

---

## Rollout & Backward Compatibility

- This is a **breaking change** for existing users: they must now enter a code. We'll need to:
  - Update README with new pairing flow
  - Show prominently in release notes
  - Optionally support `--skip-approval` for local-only testing (but we discourage)
- Introduce in v2.2.0 (or v3.0.0 if we want to make it clear it's major)

---

## Out of Scope (for now)

- Multi-user approval (multiple Discord users can control same session)
- QR code scanning for mobile
- Persistent cross-server allowlist
- Two-factor via TOTP (pairing code is sufficient)

---

## References

- Threat model: public bot, shared environment potential
- Design inspiration: SSH key passphrase, Bluetooth pairing, Discord OAuth2 implicit flow
