# claude-remote

Remote control for Claude Code. Monitor and interact with your Claude Code sessions from your phone.

## Features

- **Real-time mirroring** — your terminal session streams to a messaging channel as rich embeds
- **Bidirectional** — send messages and images from your phone, they appear in Claude's terminal
- **Permission control** — approve/deny tool calls via buttons, switch permission modes remotely
- **Smart rendering** — tool calls batched and grouped, diffs with syntax highlighting, long outputs in threads
- **Sub-agent & bash progress** — live streaming of nested agent work, bash output, and MCP tool progress
- **Image support** — send images from Discord to Claude, see image outputs from tool results
- **Task tracking** — pinned task board with progress bar, auto-updated as tasks complete
- **Message queue** — send multiple messages while Claude is busy, they execute in order
- **Session persistence** — reconnects reuse the same channel, conversation history replayed on connect
- **Plan mode UI** — dedicated buttons for plan approval, feedback, and implementation options
- **Interrupt & context control** — stop Claude, clear context, trigger compaction, all from Discord
- **Activity status** — bot presence shows idle/thinking/working state and queue count
- **Auto-update** — checks for new versions in the background

## Providers

Currently supported:
- **Discord** — embeds, buttons, threads, slash commands, select menus, modals

The codebase uses a provider abstraction (`src/provider.ts`) to make adding new providers straightforward. More planned (Telegram, Slack, etc.)

## Requirements

- Windows (macOS/Linux support planned)
- Node.js 18+
- Claude Code CLI installed
- A Discord bot token

## Install

```bash
npm install -g @hoangvu12/claude-remote
```

## Setup

```bash
claude-remote setup
```

The setup wizard will:
1. Ask for your Discord bot token (masked input, validated against Discord API)
2. Auto-detect your server, or let you pick if the bot is in multiple
3. Create a "Claude RC" category in your server
4. Install the `/discord` skill and `SessionStart` hook into Claude Code
5. Install a statusline showing sync status
6. Optionally set up a `claude` shell alias (PowerShell, Git Bash, CMD)

### Creating a Discord bot

1. Go to [Discord Developer Portal](https://discord.com/developers/applications)
2. Create a New Application, go to the **Bot** tab
3. Copy the Bot Token
4. Enable **Message Content Intent** under Privileged Gateway Intents
5. Go to **OAuth2 > URL Generator**, select the `bot` scope
6. Select permissions: **Send Messages**, **Manage Channels**, **Read Message History**, **Manage Threads**
7. Open the generated URL to invite the bot to your server

## Usage

Start Claude Code through the wrapper:

```bash
claude-remote
```

Or with the alias (if configured during setup):

```bash
claude
```

All arguments pass through to Claude Code:

```bash
claude-remote --resume
claude-remote -p "fix the login bug"
claude-remote --dangerously-skip-permissions
```

### Toggle sync

Inside a Claude Code session:

```
/discord              # toggle on/off
/discord on           # enable
/discord off          # disable
/discord my-session   # enable with custom channel name
```

### Discord slash commands

Once connected, these commands are available in the Discord channel:

| Command | Description |
|---------|-------------|
| `/mode <mode>` | Switch permission mode (default, accept edits, plan, bypass) |
| `/status` | Show session info, permission mode, activity state |
| `/stop` | Interrupt Claude (like pressing Escape) |
| `/clear` | Clear context and start a new conversation |
| `/compact [instructions]` | Trigger context compaction |
| `/queue view` | View queued messages |
| `/queue clear` | Clear all queued messages |
| `/queue remove <id>` | Remove a specific queued message |
| `/queue edit <id>` | Edit a queued message |

### Sending messages & images

Type in the Discord channel to send messages to Claude. You can also attach images — they're downloaded and forwarded to Claude as file references.

If Claude is busy, messages are queued automatically and executed in order when Claude becomes idle.

## How it works

```
Terminal                    Named Pipe IPC              Provider
+-----------+              +----------+                +----------+
| claude.exe| <-- PTY --> | rc.ts    | <-- fork --> | daemon.ts|
| (real)    |              | (wrapper)|   IPC         | (bot)    |
+-----------+              +----------+                +----------+
                                ^                           |
                                |                           v
                           JSONL watcher            Messaging channel
                           (file changes)           (embeds, buttons,
                                                     threads)
```

1. `claude-remote` spawns `claude.exe` in a pseudo-terminal (PTY)
2. A named pipe server handles IPC between the CLI and the daemon
3. The daemon connects to the provider and watches the JSONL session file
4. New JSONL lines are parsed, deduplicated, and processed through a handler pipeline
5. The handler pipeline routes messages to the appropriate rendering (inline, threads, grouped)
6. User input from the provider is sent back through IPC to the PTY as keystrokes

### Handler pipeline

Messages flow through handlers in order — each handler can claim a message or pass it along:

1. **Thinking** — renders user prompts with images
2. **Plan mode** — shows plan status with approval buttons
3. **Tasks** — tracks task lifecycle, maintains pinned task board
4. **Passive tools** — groups Read/Grep/Glob into a single summary line
5. **Tool results** — routes results inline (short) or to threads (long)
6. **Edit/Write** — renders file operations with LCS-based diffs
7. **Tool use** — handles tool invocations with permission prompts and progress timers
8. **Default** — catches everything else

## Uninstall

```bash
claude-remote uninstall
npm uninstall -g @hoangvu12/claude-remote
```

## License

MIT
