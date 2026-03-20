# External Integrations

## Discord API (Primary)

**Implementation**: `src/providers/discord.ts` – `DiscordProvider`

### Features Used

- **Authentication**: Bot token (stored in user config, passed via `DISCORD_BOT_TOKEN` env)
- **Channel Management**:
  - Creates session channels under "Claude RC" category
  - Reuses existing channels if `/remote status` detected
  - Clears channel history on context reset (`/clear`)
- **Threading**: Automatically spawns threads for long outputs; archives old threads (capped at 40)
- **Interactions**:
  - Buttons: Allow/Deny tool calls, task actions
  - Select menus: Multi-choice selections, file pickers
  - Modals: Text input forms (custom instructions)
- **Embeds**: Rich formatting with fields, colors, footers, author, images
- **Attachments**: Image uploads (from tool results), file downloads
- **Slash Commands** (registered on startup):
  - `/mode` – Change permission mode (default/bypassPermissions)
  - `/status` – Show session info
  - `/stop` – Send interrupt signal
  - `/clear` – Clear context, new channel
  - `/compact [instructions]` – Manual context compaction
  - `/queue view|clear|remove|edit` – Manage message queue

### Rate Limits & Caching

- **Outgoing rate limit**: 5 messages per 5-second sliding window
- **Caches**:
  - Messages: LRU up to 80 (edit/delete operations)
  - Threads: LRU up to 40 (reuse and archival)
- **Implementation**: `messageTimes` array tracks timestamps; throttle if limit reached.

### API Endpoints (REST)

- `POST /guilds/{guild.id}/channels` – Create category/channel
- `GET /guilds/{guild.id}/channels` – List channels (for channel reuse)
- `PATCH /channels/{channel.id}` – Edit channel (archive threads, rename)
- `POST /channels/{channel.id}/messages` – Send messages
- `PATCH /messages/{message.id}` – Edit messages
- `DELETE /messages/{message.id}` – Delete messages
- `POST /channels/{channel.id}/pins/{message.id}` – Pin task boards
- `POST /channels/{channel.id}/threads` – Create threads
- `POST /threads/{thread.id}/messages` – Send to threads
- `PATCH /threads/{thread.id}` – Archive threads
- `PUT /applications/{app.id}/commands` – Register slash commands (global or guild)

### Gateway Events (WebSocket)

- `MessageCreate` – User messages from Discord
- `InteractionCreate` – Button clicks, select menu picks, modal submissions
- `Error` – Logged to console

### Required Discord Bot Permissions

- **Send Messages**
- **Manage Channels** (create/archive threads, delete messages)
- **Read Message History**
- **Manage Threads**
- **Use Slash Commands** (implicit)

### Privileged Gateway Intent

- **MESSAGE CONTENT** – Required to read usertyped messages (not just attachments)

---

## Claude Code (via PTY + JSONL)

**Implementation**: `src/rc.ts` (parent) + `src/daemon.ts` (daemon) + `src/jsonl-parser.ts`

### Architecture

```
┌─────────────────────────────────────────────────────────┐
│ Terminal                                                 │
│                                                          │
│  $ claude-remote                                         │
│  ┌────────────────────────────────────────────┐        │
│  │ Parent (rc.js)                             │        │
│  │  • PTY: claude.exe (node-pty)             │        │
│  │  • Named pipe server: \\\\pipe\\...       │        │
│  │  • Stdin/stdout forwarding                │        │
│  └────────────────────────────────────────────┘        │
│         │ PTY I/O                            │ IPC      │
│         ▼                                     ▼        │
│  ┌─────────────┐                     ┌─────────────┐  │
│  │ claude.exe  │                     │ Daemon      │  │
│  │ (Claude     │                     │  • Discord  │  │
│  │  Code)      │                     │  • JSONL    │  │
│  └─────────────┘                     │    watcher  │  │
│                                       │  • Handlers │  │
│                                       └─────────────┘  │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

### JSONL Transcript Format

Claude Code writes one JSON object per line to `~/.claude/transcripts/<session-id>.jsonl`.

**Message types**:

| Type | Direction | Content |
|------|-----------|---------|
| `user` | User → Claude | Prompt text, attachments, selected options |
| `assistant` | Claude → User | Response text, `content` array with `tool_use` blocks |
| `system` | System | Errors, warnings, status messages |
| `tool-result` | Tool → Claude | Output of tool execution (stdout, stderr, files) |
| `file-edit` | File operation | `Edit`, `Write` tools rendered as diffs |
| `task-start` / `task-end` | Task lifecycle | Progress tracking |
| `thinking-start` / `thinking-end` | Thinking visibility | Show/hide reasoning |

### PTY Key Simulation

Claude Code uses Ink select menus (arrow-key navigation). To send approvals from Discord:

1. Send ` ` (space) to focus the prompt
2. Send `\x1b[B` (arrow down) to move to desired option
3. Send `\r` (enter) to click

Delays of ~150ms per key required for menu to process. Implemented in `daemon.ts` → IPC → `rc.ts` → PTY write.

### IPC Protocol (Named Pipes)

**Parent → Daemon** messages:

```typescript
{ type: "session-register", sessionId, transcriptPath, cwd? }
{ type: "enable", channelName? }
{ type: "disable" }
{ type: "pty-write", text: string, raw: boolean }
{ type: "state-signal", event: "stop" | "post-compact", trigger?: "manual" | "auto" }
```

**Daemon → Parent** messages:

```typescript
{ type: "session-info", sessionId, transcriptPath, cwd? }
{ type: "signal", signal: "SIGINT" | ... }
{ type: "interaction", interaction: ProviderInteraction }
```

**Transport**: Windows named pipe (`\\.\pipe\claude-remote-<pid>`). `rc.ts` creates server; daemon connects via `CLAUDE_REMOTE_PIPE` environment variable set by `session-hook.js`.

### Hook Integration

Claude Code settings (`~/.claude/settings.json`) installs:

- **`SessionStart` hook**: `session-hook.js` reads `CLAUDE_REMOTE_PIPE` and sends `session-register` to parent.
- **`Stop` hook**: `state-hook.js` sends `state-signal` (idle transition).
- **`PostCompact` hook**: `state-hook.js` sends `state-signal` after manual `/compact`.

### Claude Code Version Compatibility

- Assumes JSONL format and hook behavior from Claude Code v1.0+.
- No version detection; breaking changes in Claude Code could break this tool.

---

## NPM Registry

**Purpose**: Self-update mechanism.

**Implementation**: `src/cli.ts` – `checkForUpdates()`, `selfUpdate()`

### Behavior

- Non-blocking background check every 1 hour (cached in `~/.claude/claude-remote/update-check.json`)
- Manual update: `claude-remote update`
- Fetches `https://registry.npmjs.org/@hoangvu12/claude-remote/latest`
- Executes `npm install -g @hoangvu12/claude-remote@latest`

### Security Note

Network fetch from npm registry. If compromised, could return malicious version string. However, npm install validates package integrity via registry signatures. The `execSync` pattern is discouraged but acceptable given controlled input.

---

## File System

### Configuration Paths

- **Config dir**: `~/.claude/claude-remote/`
  - `config.json` – User credentials (bot token, guild ID, category ID)
  - `status` – Simple flag file (enabled/disabled)
  - `update-check.json` – Latest version cache
  - `pipe-registry/` – Named pipe metadata (PID, pipe name, cwd, startedAt)

- **Claude settings**: `~/.claude/settings.json` (modified by install)
- **Skills**: `~/.claude/skills/remote/SKILL.md`
- **Transcripts**: `~/.claude/transcripts/<session-id>.jsonl`
- **Statusline**: Per-platform temp script (node invoking `statusline.js` from package)

### Watched Files

- **JSONL transcript** (`chokidar`): Changes trigger parse → pipeline
- **Settings.json** (potential future feature – detect hook changes)

### Temp Files

- PTY allocation uses OS temp directory (node-pty internal)
- No explicit temp files created by this codebase.

---

## Claude Code Settings System

Claude Code supports extensibility via:

- **Skills**: Slash commands (`/remote`) implemented as skill (`~/.claude/skills/remote/SKILL.md`)
- **Hooks**: Event-driven scripts (`SessionStart`, `Stop`, `PostCompact`)
- **Statusline**: Custom command output displayed in status bar

### Installed Settings

**Statusline**:

```json
{
  "statusLine": {
    "type": "command",
    "command": "node \"<...>/statusline.js\""
  }
}
```

The statusline script outputs a single line with emoji indicating sync state.

**Hooks**:

```json
{
  "hooks": {
    "SessionStart": [{ "matcher": "", "hooks": [{ "type": "command", "command": "node \"<...>/session-hook.js\"", "timeout": 5000 }] }],
    "Stop": [...],
    "PostCompact": [...]
  }
}
```

`timeout: 5000` ensures hooks don't block Claude indefinitely.

---

## GitHub

- **Repository**: https://github.com/hoangvu12/claude-remote.git
- **Workflows**: `.github/workflows/publish.yml` – On GitHub Release → `npm publish`
- **Issues**: GitHub Issues (not heavily used yet)
- **Distribution**: npm (public scope `@hoangvu12`)

---

## Future Integration Points

### Provider Abstraction for New Platforms

`src/provider.ts` defines interfaces. To add Telegram or Slack:

1. Implement `OutputProvider` (and optionally `ThreadCapable`, `InputCapable`)
2. Register in daemon based on configuration
3. Handle Telegram/Slack webhooks or bot APIs

No core logic changes required.

### Webhooks (Not Implemented)

README mentions webhooks but code does not expose any HTTP server. Could be added for external integrations (CI/CD triggers, monitoring).

### Local HTTP API (Not Implemented)

Would allow programmatic control (e.g., VS Code extension). Not present.

---

## Dependency Graph

```
@hoangvu12/claude-remote
├─ @clack/prompts (CLI UI)
├─ chokidar (file watching)
├─ discord.js (Discord bot)
│  └─ ws (WebSocket)
│  └─ @discordjs/rest (REST)
├─ node-pty (PTY)
└─ picocolors (terminal colors)

Dev:
└─ typescript, @types/node
```

All dependencies are pure JS (no native builds except `node-pty` which has prebuilds for Windows).

---

## Security Considerations of Integrations

- **Discord bot token**: Stored in `~/.claude/claude-remote/config.json` (0600 permissions not enforced, but local file). Passed to daemon via environment variable (not visible to other processes via `/proc` on Windows? Not guaranteed).
- **Claude Code transcript**: Contains full conversation, may include API keys if user pastes them. Not encrypted.
- **IPC pipe**: No authentication; any local process could connect to pipe if they know name (low risk).
- **Self-update**: Uses `npm install -g` with version from remote registry (trusts npm's signature verification).

---

## Integration Test Checklist

When modifying integrations:

1. ✅ Discord bot can connect and send messages
2. ✅ Channel creation/reuse works
3. ✅ Buttons and select menus appear and respond
4. `/remote on` creates channel and starts forwarding
5. Tool approvals (Allow/Deny) actually affect Claude
6. Large outputs route to threads
7. Task boards appear and update
8. `/stop` sends SIGINT and stops Claude
9. `/clear` creates new channel and resets context
10. `/compact` compacts and displays summary
11. `/remote off` disables sync without killing Claude

---

**Integration stability**: Discord API changes may break; discord.js v15 upcoming. Monitor compatibility.
