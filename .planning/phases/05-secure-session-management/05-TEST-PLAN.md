# Integration & UAT Test Plan

This document outlines manual test scenarios to verify the pairing code authorization system.

## Prerequisites

- A working `claude-remote` installation with Discord bot configured.
- The bot is invited to a test Discord server with appropriate permissions.
- Build the project: `npm run build`
- Run `claude-remote` (not in background) to see terminal output.

## Test Scenarios

### TC1: Pairing Code Display

**Steps:**
1. Start `claude-remote` and enable remote sync by typing `/remote on` in the Claude terminal.
2. Observe terminal output.

**Expected:**
- A 6-digit numeric code is displayed.
- Clear instruction: "Enter this code in Discord to enable remote control."
- The code is shown only once (immediately after enabling).

### TC2: Unauthorized Command Blocked

**Steps:**
1. After starting remote (session active), in Discord, try to use any slash command (e.g., `/status`, `/mode`, `/clear`) without prior authorization.
2. Observe the response.

**Expected:**
- Ephemeral reply: "❌ You are not authorized to use these commands. Enter the 6-digit code shown in the terminal to authorize."
- No state changes occur.

### TC3: Authorization Flow

**Steps:**
1. In Discord, enter `/auth <code>` where `<code>` is the code from TC1.
2. Observe response.
3. After successful auth, issue `/status` to verify.

**Expected:**
- Ephemeral reply: "✅ Authorized! You can now use Discord commands."
- `/status` shows session info (project, session ID, mode, activity).

### TC4: Invalid Code Handling

**Steps:**
1. Intentionally enter wrong code: `/auth 000000`.
2. Repeat until attempts exhausted.
3. Observe responses and rate limit.

**Expected:**
- First wrong attempt: ephemeral "❌ Authorization failed: Invalid code. Check the terminal and try again."
- Attempt counter decrements as per remaining attempts.
- After 5 failures: ephemeral "❌ Authorization failed: Too many attempts. Please wait 10 minutes." and further attempts blocked.
- Block expires after ~10 minutes (check via subsequent tries).

### TC5: Expired Code

**Steps:**
1. Wait >60 seconds after code generation without entering it.
2. Try `/auth` with the expired code.

**Expected:**
- Ephemeral error indicating code expired.
- Option to generate a new code by restarting remote or using `/remote off`/`on`.

### TC6: Button Interaction Authorization

**Steps:**
1. As an authorized user, trigger a tool call that produces buttons (e.g., a file edit with Accept/Deny).
2. As an unauthorized Discord user (different account or ask a friend), click the "Allow" or "Deny" button.
3. Observe behavior.

**Expected:**
- Unauthorized user gets an ephemeral reply: "❌ You are not authorized to use these commands."
- No action is taken (tool call not approved/denied).
- Authorized user can still interact with buttons.

### TC7: Single-User Approval Model

**Steps:**
1. Authorize with Discord user A.
2. Have Discord user B try to authorize with the same code (or just use commands).
3. Observe that user B cannot gain control unless the session is restarted.

**Expected:**
- User B cannot execute commands; gets not authorized error.
- The approval is tied to the first user who entered the correct code.
- Restarting the session (e.g., `/remote off` and `/remote on`) generates a new code and clears approval.

### TC8: RC Restart Clears Approval

**Steps:**
1. Authorize user A.
2. Stop `claude-remote` (Ctrl-C) and restart.
3. Try using commands as user A without re-authorizing.

**Expected:**
- User A is no longer authorized; must enter new code.
- This confirms approval is in-memory only.

### TC9: Normal Operations After Authorization

**Steps:**
1. Authorize successfully.
2. Use `/mode plan`, `/compact`, `/stop`, `/queue view`, `/model haiku`.
3. Verify each command executes and replies are as expected.

**Expected:**
- All authorized commands work normally.
- No authorization errors.

### TC10: Message Queue Management

**Steps:**
1. As authorized user, send multiple prompts from Discord (e.g., "what is 2+2?" then "and 3+3?").
2. Use `/queue view` to see queued messages.
3. Edit a queued message via the edit modal, remove one, clear all.
4. Verify behavior.

**Expected:**
- Queue displays IDs and text snippets.
- Edit modal opens, saves changes.
- Remove and clear operations succeed.

### TC11: File Attachments

**Steps:**
1. As authorized user, send a Discord message with an image attachment.
2. Ensure Claude processes the image.

**Expected:**
- The image is transmitted to Claude and processed.

## Reporting

Record any deviations from expected results, including error messages, logs, and steps to reproduce.

## Notes

- All tests assume a fresh session to avoid residual state.
- Use a test Discord server to avoid disrupting production channels.
- After testing, stop claude-remote to clean up the daemon process.
