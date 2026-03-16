# claude-discord-rc

Discord Remote Control for Claude Code. Monitor and interact with your Claude Code sessions from Discord on your phone.

## What it does

- Mirrors your Claude Code terminal session to a Discord channel in real time
- Send messages from Discord and they appear in Claude's terminal
- Approve/deny tool permissions from Discord via buttons
- Each session gets its own channel under a "Claude RC" category
- Resumes the same channel when you reconnect to an existing session
- Shows "Discord RC: On/Off" in Claude Code's statusline

## Requirements

- Windows (macOS/Linux support planned)
- Node.js 18+
- Claude Code CLI installed
- A Discord bot (setup wizard walks you through it)

## Install

```bash
npm install -g claude-discord-rc
```

## Setup

```bash
discord-rc setup
```

This will:
1. Ask for your Discord bot token (masked input, validated against Discord API)
2. Auto-detect your server, or let you pick if the bot is in multiple
3. Create a "Claude RC" category in your server
4. Install the `/discord` command into Claude Code
5. Install a statusline showing sync status
6. Optionally set up a `claude` shell alias so you can type `claude` instead of `discord-rc`

### Creating the Discord bot

1. Go to https://discord.com/developers/applications
2. Create a New Application, go to the Bot tab
3. Copy the Bot Token
4. Enable **Message Content Intent** under Privileged Gateway Intents
5. Go to OAuth2 > URL Generator, select the `bot` scope
6. Select permissions: Send Messages, Manage Channels, Read Message History
7. Open the generated URL to invite the bot to your server

## Usage

Start Claude Code through the wrapper:

```bash
discord-rc
```

Or if you set up the alias during setup:

```bash
claude
```

All arguments are passed through to Claude Code:

```bash
discord-rc --resume
discord-rc -p "fix the login bug"
discord-rc --dangerously-skip-permissions
```

### Toggle Discord sync

Inside a Claude Code session, type:

```
/discord              # toggle on/off
/discord on           # enable
/discord off          # disable
/discord my-session   # enable with custom channel name
```

When enabled:
- A new channel appears under "Claude RC" in your Discord server
- The conversation is replayed (last 10 text messages summarized, last 5 in full)
- New messages stream to Discord in real time
- Tool calls are batched and grouped with their results
- You can type in Discord and it goes to Claude's terminal

When disabled:
- The channel stays as history
- Re-enabling reuses the same channel for the same session

## How it works

```
Terminal                    Named Pipe IPC              Discord
+-----------+              +----------+                +----------+
| claude.exe| <-- PTY --> | rc.ts    | <-- fork --> | daemon.ts|
| (real)    |              | (wrapper)|   IPC         | (bot)    |
+-----------+              +----------+                +----------+
                                ^                           |
                                |                           v
                           JSONL watcher            Discord channel
                           (file changes)           (messages, embeds,
                                                     buttons)
```

1. `discord-rc` spawns `claude.exe` in a pseudo-terminal (PTY)
2. A named pipe server listens for `/discord` commands
3. When enabled, a daemon process connects to Discord and watches the JSONL session file
4. New JSONL lines are parsed, filtered (internal/system messages removed), batched, and rendered as Discord embeds
5. Discord messages are sent back through IPC to the PTY as keystrokes

## Discord rendering

- **User prompts**: Blue/blurple embed with "You" header
- **Claude responses**: Blue embed with "Claude" header, auto-split for long messages
- **Tool calls**: Dark gray embeds, grouped with results (e.g. "Edit src/cli.ts -> success")
- **Errors**: Red embeds
- **Permissions**: Orange embed with Allow/Deny buttons
- **System messages**: Gray embeds (context compacted, turn duration, etc.)

Rapid tool calls are batched (600ms debounce) into single Discord messages with multiple embeds.

## Uninstall

```bash
discord-rc uninstall
npm uninstall -g claude-discord-rc
```

## Project structure

```
src/
  cli.ts              - CLI entry point (setup/uninstall/run)
  rc.ts               - PTY wrapper, named pipe server, daemon management
  daemon.ts           - Discord bot, JSONL watcher, message relay
  discord-renderer.ts - Converts processed messages to Discord embeds
  jsonl-parser.ts     - Parses Claude's JSONL session files
  discord-cmd.ts      - Standalone CLI for /discord skill
  discord-hook.ts     - UserPromptSubmit hook (legacy, kept for compat)
  pipe-client.ts      - Shared named pipe client utilities
  statusline.ts       - Claude Code statusline script
  types.ts            - Shared TypeScript types
  utils.ts            - Shared constants and helpers
```

## License

MIT
