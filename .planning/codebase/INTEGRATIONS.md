# External Integrations

## Discord API

**Purpose**: Primary output provider - all Claude communication flows through Discord.

**Implementation**: `src/providers/discord.ts` (`DiscordProvider`)

### Features Used

- **Bot Token Authentication**: Standard Discord bot login
- **Channel Management**:
  - Creates session channels under a configured category
  - Reuses existing channels with `/remote status` patterns
  - Clears channel history on context reset
- **Threading**: Long conversations organized into threads automatically
- **Interactions**:
  - Buttons (Allow/Deny for tool calls, selections)
  - Select menus (multi-choice, file selection)
  - Modals (text input forms)
- **Embeds**: Rich formatting for messages, diffs, tool results
- **Attachments**: Image uploads, file attachments
- **Slash Commands**: `/mode`, `/status`, `/stop`, `/clear`, `/compact`, `/queue`
- **Message Components**: Pinned task boards with progress bars

### Rate Limits

- **Outgoing**: 5 messages per 5-second sliding window
- **Caches**: Up to 80 messages, 40 threads (LRU eviction)

### API Endpoints Used

- `POST /guilds/{guild.id}/channels` - Create category/channel
- `GET /guilds/{guild.id}/channels` - List channels (for reuse)
- WebSocket gateway: MessageCreate, InteractionCreate events
- REST interactions: Edit/delete messages, create threads, pin messages

### Configuration

- Bot token stored in `~/.claude/claude-remote/config.json`
- Category created during setup: "Claude RC"
- Requires Bot scopes: `bot`
- Required permissions: `Send Messages`, `Manage Channels`, `Read Message History`, `Manage Threads`
- Privileged intent: `MESSAGE CONTENT` (to read user messages)

---

## Claude Code (via PTY & JSONL)

**Purpose**: Core integration - runs Claude Code and streams its output.

### Two-Process Architecture

**Parent Process** (`rc.ts`)
- Spawns `claude.exe` in a PTY (node-pty)
- Creates named pipe server for daemon IPC
- Forwards daemon messages to PTY as keystrokes
- Handles signal propagation (Ctrl+C)

**Daemon Process** (`daemon.ts`)
- Connects to Discord
- Watches Claude's JSONL transcript file
- Parses messages and routes to handler pipeline
- Sends Discord interactions back to parent via IPC

### JSONL Transcript Format

Claude Code writes structured JSONL with these message types:

- `user` - User prompts, including tool approvals
- `assistant` - Claude responses, tool use blocks
- `system` - System messages, errors
- Non-conversation events: `tool-result`, `file-read`, `file-write`, `edit-result`, `task-start`, `task-end`, `thinking-start`, `thinking-end`

Integration parses these via `src/jsonl-parser.ts` and routes through handler pipeline.

### PTY Key Simulation

To send messages to Claude from Discord:
- Claude Code uses Ink select menus (arrow-key navigation)
- Must send key sequences with delays (150ms per key)
- Enter key (`\r`) to submit
- Simulated via `process.send({ type: "pty-write", text, raw })`

### Slash Commands & Hooks

- `/remote` skill installed to `~/.claude/skills/remote/`
- Hook scripts:
  - `session-hook.js` - Registers session with parent
  - `state-hook.js` - Updates idle/busy state
  - `discord-hook.js` - Not on specific events (legacy/migration)
- Statusline: Custom command shows remote status in Claude's status bar

---

## NPM Registry

**Purpose**: Auto-update checking and self-update.

**Implementation**: `src/cli.ts` (`checkForUpdates()`, `selfUpdate()`)

- Polls `https://registry.npmjs.org/@hoangvu12/claude-remote/latest`
- Non-blocking check every hour (cached)
- `claude-remote update` performs in-place global npm install

---

## File System

**Purpose**: Configuration, state persistence, PTY temp files.

### KeyPaths

- Config: `~/.claude/claude-remote/config.json`
- Settings: `~/.claude/settings.json` (Claude Code settings)
- Skills: `~/.claude/skills/remote/`
- JSONL transcript: `~/.claude/transcripts/<session-id>.jsonl`
- Temp PTY files: OS temp directory (node-pty)

### Files watched

- JSONL transcript (chokidar) - tailing new lines
- Claude settings.json (for future features)

---

## Claude Code Settings System

**Purpose**: Integrates with Claude Code's extensibility points.

### Modified Settings

```json
{
  "statusLine": {
    "type": "command",
    "command": "node \"<claude-remote>/statusline.js\""
  },
  "hooks": {
    "SessionStart": [{
      "hooks": [{
        "type": "command",
        "command": "node \"<claude-remote>/session-hook.js\"",
        "timeout": 5000
      }]
    }],
    "Stop": [...],
    "PostCompact": [...]
  }
}
```

The statusline.js script outputs a single line like "● Remote: ON" or "○ Remote: OFF" for display in Claude's status bar.

---

## GitHub

**Purpose**: Distribution via GitHub Packages (public npm).

**Repository**: `https://github.com/hoangvu12/claude-remote.git`

**Publish Workflow**: `.github/workflows/publish.yml`
- On release publish → npm publish (public access)

---

## Future Integration Points

- **Telegram/Slack**: Provider interface designed for multiple backends (`src/provider.ts`)
- **Webhooks**: Mentioned in README but not implemented
- **Local HTTP API**: Could expose REST control plane (not yet)
