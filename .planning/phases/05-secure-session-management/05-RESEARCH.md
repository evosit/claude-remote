# Research: Secure Session Management (P5)

**Phase**: 05-secure-session-management
**Date**: 2026-03-22
**Status**: Draft

---

## Discord.js API Survey

### Ephemeral Messages

Discord supports ephemeral (private) responses visible only to the interaction author:

```typescript
await interaction.reply({
  content: 'Only you can see this',
  ephemeral: true
});
```

This is perfect for:
- Sending the pairing code to be displayed only to the user who issued `/remote on`
- Showing error messages "Invalid code" without revealing to others
- Prompting for code input (follow-up ephemeral)

**Limitation**: Ephemeral messages can only be sent as the first response to an interaction (within 3 seconds). If we need more time, we must use `deferReply({ ephemeral: true })` initially, then follow up.

### Slash Command Modals

We can present a modal dialog for the user to enter the pairing code:

```typescript
const modal = new ModalBuilder()
  .setCustomId('pairing-code-modal')
  .setTitle('Enter Pairing Code');

const codeInput = new TextInputBuilder()
  .setCustomId('code')
  .setLabel('Pairing Code')
  .setStyle(TextInputStyle.Short)
  .setMinLength(6)
  .setMaxLength(6)
  .setRequired(true)
  .setPlaceholder('Enter 6-digit code from terminal');

modal.addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(codeInput));

await interaction.showModal(modal);
```

**Workflow**:
1. User types `/remote on` in channel
2. Bot responds ephemeral: "Please enter the pairing code from your terminal" and immediately shows modal
3. User enters code → modal submit → bot verifies via IPC → responds

Alternatively, simpler: `/remote on <code>` as a string option. This is less interactive but avoids modals.

### Discord User ID

From an interaction, we can get the Discord user who invoked it:

```typescript
const userId = interaction.user.id;
const username = interaction.user.username;
```

We'll store `(sessionId, discordUserId)` as the approved authorization. This binds the authorization to the specific Discord user.

---

## Approval Data Structure

We need to track pending and approved authorizations.

### In-Memory Store in RC

`rc.ts` will maintain:

```typescript
interface ApprovalState {
  sessionId: string;
  // Pending approval code (active for 60s)
  pendingCode: string | null;
  pendingCodeExpiresAt: number;
  // Who is approved (once code is verified)
  approvedDiscordUserId: string | null;
  approvedAt: number | null;
  // Code attempt counters for rate limiting
  failedAttempts: number;
}
```

We'll use a `Map<string, ApprovalState>` keyed by `sessionId` (one per RC instance).

### IPC Methods

RC will expose via pipe server:

- `generate-approval-code` → returns `{ code: string }`
  - Generated at startup if Discord sync enabled; stored in `pendingCode`
  - Regenerated if expired or used
- `verify-approval-code` `{ sessionId, code, discordUserId }` → `{ ok: boolean, message?: string }`
  - Check against `pendingCode` for that session, check expiry and attempt count
  - If valid: clear `pendingCode`, set `approvedDiscordUserId`, record `approvedAt`
  - Returns success; Discord-side then completes the interaction
- `check-approved` `{ sessionId, discordUserId }` → `{ approved: boolean }`
  - Used by slash commands to verify before proceeding

---

## Flow Diagrams

### Activation Flow

```
+-----------+        +-----------+        +-------------------+
| Terminal  |        |   RC      |        |    Discord Bot    |
+-----------+        +-----------+        +-------------------+
     |                     |                        |
     | claude-remote       |                        |
     |-------------------->|                        |
     |                     | start Daemon           |
     |                     |--------------------->|
     |                     |                        | creates channel
     |                     |                        |
     |                     | generateCode()         |
     |<--------------------|                        |
     | Display: "Enter code 123456 in Discord"       |
     |                     |                        |
     |                     |                        | /remote on
     |                     |                        |----------->|
     |                     |                        | ephemeral: "Enter code"
     |                     |                        | show modal
     |                     |                        |<-----------|
     |                     |                        |
     | user enters code    |                        |
     |-------------------->|                        |
     |                     | verifyCode() via IPC   |
     |                     |<---------------------|
     |                     |                        |
     |                     | approve                |
     |<--------------------|                        |
     |                     |                        |
     |                     |                        | Success response
     |                     |                        |----------->|
```

### Message Flow with Authorization

For a Discord user message in the channel:

- Daemon (listening on events) receives `interactionCreate` for button/select
- It should verify the interaction's `user.id` matches the approved user for the session before executing
- This check can be done in `slash-commands.ts` and also in `discord-hook.ts` (for button clicks in non-command interactions)

Implementation:

```typescript
// In slash-commands handler for /remote on/off/status
if (!await isAuthorized(sessionId, interaction.user.id)) {
  await interaction.reply({ content: '❌ This session is not authorized. Enter the pairing code from the terminal.', ephemeral: true });
  return;
}
```

For interactive components (Allow/Deny buttons, queued messages, etc.), similar check:

```typescript
const authorized = await rcIPC.checkApproved(ctx.sessionId, interaction.user.id);
if (!authorized) {
  await interaction.reply({ content: '❌ You are not authorized for this session.', ephemeral: true });
  return;
}
```

---

## Security Analysis

### Threat Model

- **Attacker**: Any Discord user who can see the bot in a server where the bot is installed.
- **Attack vector**: Type `/remote on` and attempt to control a `claude-remote` session.
- **Without fix**: Attacker can enable remote and send messages to Claude, potentially executing commands or reading responses.
- **With fix**: Attacker needs the 6-digit code displayed only on the terminal where `claude-remote` is running. Without that, they cannot activate.

### Code Entropy

- 6-digit numeric code: 10^6 = 1,000,000 possibilities → ~20 bits of entropy
- Rate limiting: limit to 5 attempts per session per 10 minutes → probability of guessing reduces drastically
- Brute-force attack would take ~200,000 attempts on average to succeed within 10 min window (given 5 tries) → infeasible
- Could increase to 8 digits (100 million) or alphanumeric if needed.

### Code Transmission

- Code is displayed in terminal (stdout) during startup
- It's not stored in any file (in-memory only)
- TTL is short (60 seconds) → window for interception by local attacker is limited
- If attacker has local shell access to view terminal, they already have full compromise of the system (so this is acceptable)

### Replay Protection

- Code is single-use: once verified successfully, it's cleared
- Stale code after TTL is not accepted

### Session Binding

- Approval is stored as `(sessionId, discordUserId)` → only that Discord user can use that session
- Even if they share the code with someone else in another server, that other person cannot use it because they'd need to be in the same Discord channel; but channel is per-session and the session is watching that channel. If they are in that channel, they could theoretically message, but only if they also have the code? Actually once the original user approves, we set `approvedDiscordUserId` and all subsequent interactions from that user are allowed. If they share the channel with a malicious user, that user could also send messages through the bot (by clicking buttons or typing). But we can extend: instead of storing a single user ID, we could allow all users in the channel but require per-message approval? Or we could implement "session owner only" by checking interaction.user.id against authorized ID. That's simplest: only the user who entered the code can control. We'll implement that.

---

## Outstanding Questions

1. **Should `/remote status` require approval?**
   - Likely yes, because it reveals session state. But could be public info? Safer to require.

2. **What about `/remote off`?**
   - Must require approval (only authorized user can disable)

3. **Hot-reload scenario** (daemon exits with code 42 and restarts):
   - RC process does not restart; daemon restart happens internally. Approval persists. Good.

4. **RC process restart**:
   - New code generated. Old approvals invalid. User must re-enter code.
   - This is acceptable: new RC process = new session opportunity.

5. **Multiple channels?** Actually each RC creates one channel. Not a concern.

6. **Ephemeral messages cost**? No, ephemerals are free.

---

## Design Alternatives Considered

### 1. Terminal Approval via Command

User runs `claude-remote --approve <code>` in the same terminal to authorize a Discord user.

**Rejected**: Too many steps; user would have to see code, then type separate command. The modal approach is smoother.

### 2. Two-Factor via TOTP

Generate TOTP secret at startup; user needs app to generate code.

**Rejected**: Too heavy. Pairing code is simpler and equally secure for this use case.

### 3. No Approval, Just Session Isolation

Rely on the fact that each RC creates its own channel and only that channel's messages are processed. Assume users won't maliciously type `/remote on` in their own server (they would be authorizing themselves). Attack scenario requires someone else adding bot to their server and trying to hijack an active session—that's prevented by code.

**Accepted**: That is the baseline, but we add code to prevent even the user themselves from accidentally enabling in the wrong server? Actually it's fine: if a user adds bot to their server, they are authorizing their own sessions. The code is a shared secret between the terminal and the Discord user who can see the channel. That's okay.

---

## Conclusion

We'll implement:
- `ApprovalManager` in RC
- Generate 6-digit code at startup (if Discord enabled)
- Display code in terminal
- Slash commands check authorization via IPC before proceeding
- Use ephemeral modal for code entry (or `/remote on <code>` option)
- Rate limiting (max 5 attempts, 10 min lockout)
- Bind to Discord user ID

Next step: Create the PLAN.md with concrete tasks and file changes.
