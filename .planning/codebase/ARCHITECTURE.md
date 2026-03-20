# Architecture

## Overview

`claude-remote` implements a **multi-process bridge** between Claude Code (terminal AI assistant) and Discord. It spawns Claude in a pseudo-terminal, captures its JSONL transcript, and streams it to a Discord bot with rich interactions. User input from Discord flows back to Claude via simulated keystrokes.

```
┌─────────────┐
│   User      │
│   runs      │
│ claude-     │
│ remote      │
└──────┬──────┘
       │ spawns
       ▼
┌─────────────────┐           PTY I/O                 ┌─────────────┐
│   Parent (rc)   │◄─────────────────────────────────►│ claude.exe  │
│                 │                                    │ (Claude     │
│ • Windows PTY   │                                    │  Code)      │
│ • Named pipe    │                                    └─────────────┘
│   server        │
│ • stdin/stdout  │
│   forwarding    │
└──────┬──────────┘
       │ IPC (JSON)
       ▼ fork
┌─────────────────┐
│   Daemon        │
│                 │
│ • Discord bot   │
│ • JSONL watcher │
│ • Handler       │
│   pipeline      │
│ • Provider      │
└──────┬──────────┘
       │ WebSocket + HTTP API
       ▼
   Discord
```

## Architectural Patterns

### Provider Abstraction

**Location**: `src/provider.ts`

The codebase defines a platform-agnostic provider interface for output and input:

- `OutputProvider` - send/edit/delete/pin messages
- `ThreadCapable` - optional: create/manage threads
- `InputCapable` - optional: receive user messages and interactions

**Current implementation**: `DiscordProvider` (`src/providers/discord.ts`)

This allows for future providers (Telegram, Slack, web UI) without touching core logic.

### Handler Pipeline

**Location**: `src/pipeline.ts`, `src/create-pipeline.ts`

Messages from Claude are processed through a **chain of responsibility**:

```typescript
pipeline.register(new ThinkingHandler());    // thinking indicator
pipeline.register(new PlanModeHandler());    // plan mode status
pipeline.register(new TaskHandler());        // task boards
pipeline.register(new PassiveToolHandler()); // read/grep/glob (boring)
pipeline.register(new ToolResultHandler());  // tool results routing
pipeline.register(new EditWriteHandler());   // file edits display
pipeline.register(new ToolUseHandler());     // other tools
pipeline.register(new DefaultHandler());     // everything else
```

Each handler decides:
- Whether to handle the message (`consumed` return)
- Whether to render inline or in a thread
- How to format the output (embed, code block, diff)

### JSONL Streaming & Parsing

**Location**: `src/daemon.ts`, `src/jsonl-parser.ts`

Claude Code writes conversation to a JSONL file (one JSON object per line). The daemon:

1. Uses `chokidar` to watch the file for changes
2. On change, reads new lines since last position
3. Parses each line as Claude message type
4. Converts to `ProcessedMessage` with normalized fields
5. Routes through handler pipeline

**Message Types**:

- `user` - User prompts (text, attachments, selected options)
- `assistant` - Claude responses (text, tool use blocks)
- `system` - System messages (errors, warnings)
- `tool-result` - Tool execution results
- `file-edit` - File changes (Edit/Write tools)
- `task-start` / `task-end` - Task lifecycle
- `thinking-start` / `thinking-end` - Thinking visibility toggle

### PTY Bridge

**Location**: `src/rc.ts`

The parent process manages the PTY (pseudo-terminal):

- Spawns `claude.exe` with `node-pty`
- Forwards PTY output to terminal (user sees Claude)
- Forwards user keyboard input to PTY
- Creates named pipe server for daemon IPC
- Resizes PTY on terminal resize events
- Handles exit cleanup (terminal restore, daemon stop)

**Key challenge**: Claude Code uses Ink select menus requiring precise key sequences with delays. The daemon sends keys via IPC → PTY to simulate user selections.

### IPC Protocol

**Between parent (rc) and daemon** - Named pipes (`\\.\pipe\claude-remote-<pid>`)

**Parent → Daemon**:
- `session-register` - Daemon connects to parent
- `enable` - Enable remote sync
- `disable` - Disable remote sync
- `pty-write` - Send keystrokes to Claude
- `state-signal` - Notify of idle/busy transitions

**Daemon → Parent**:
- `session-info` - Session details (id, transcript path)
- `signal` - Request signal to Claude (SIGINT, etc.)
- `interaction` - Response to button/select interactions

### State Management

**Session Context** (`src/handler.ts` - `SessionContext`)

Shared state across handlers:
- `provider` - Current DiscordProvider instance
- `channel` - Current Discord channel
- `isEnabled` - Remote sync enabled/disabled
- `isBusy` - Claude is currently responding
- `taskBoardHandle` - Pinned task progress message
- `passiveGroup` - For bundling passive tool outputs
- `activeThreads` - Thread cache

**Activity Manager** (`src/activity.ts`)

Tracks Claude's idle/busy state based on:
- JSONL activity (new lines = active)
- Message processing events
- Timeout: 2 minutes of inactivity → idle

Used for statusline display and Discord presence.

## Data Flow

### Claude → Discord (outbound)

1. Claude writes JSONL to transcript file
2. `chokidar` detects change → `daemon.ts` reads new lines
3. JSON parsed → `ProcessedMessage` created
4. `handlerPipeline.process()` iterates handlers
5. Handler calls `provider.send()` to Discord
6. Messages cached in `DiscordProvider.messageCache`
7. Rate limiting enforced (5/5sec sliding window)

### Discord → Claude (inbound)

1. User clicks button / selects option / submits modal
2. Discord.js emits `InteractionCreate`
3. `DiscordProvider.handleInteraction()` extracts customId
4. Converts to internal `ProviderInteraction`
5. Calls `ctx.onInteraction` callback
6. `daemon.ts` queues HTTP response to interaction
7. May send IPC to parent (e.g., `pty-write` for Allow/Deny)
8. Parent writes to PTY → Claude receives keystrokes

### Tool Call Approvals

**Allow/Deny buttons**:
1. `ToolUseHandler` renders tool call with buttons
2. User clicks → `interaction` → `handleToolInteraction()`
3. If selected, send `" "` (space) to PTY for focus
4. Send arrow keys to navigate to button
5. Send `Enter` to click
6. Return `true` to mark consumed

This simulates actual keyboard navigation through Claude's prompt menu.

## Entry Points

- `src/cli.ts` - `claude-remote` command
  - `setup` - Configure Discord bot, install hooks
  - `uninstall` - Remove all traces
  - `update` - Self-update from npm
  - `start` (default) - Spawn parent (rc.ts)

- `src/rc.ts` - Parent process (forked by CLI)
  - Spawns Claude in PTY
  - Starts daemon as separate process
  - Handles IPC with daemon

- `src/daemon.ts` - Discord bot process
  - Connects to Discord
  - Watches transcript
  - Runs handler pipeline

- `src/remote-cmd.ts` - Control utility
  - Sends commands to running daemon via IPC
  - Used by `/remote` skill in Claude

## Process Model

```
┌─────────────────────────────────────────────────────┐
│ Terminal                                            │
│                                                      │
│  $ claude-remote                                    │
│  ┌────────────────────────────────────────────┐   │
│  │ Parent (rc.js)                             │   │
│  │  PTY: claude.exe                          │   │
│  │  Pipe server: claude-remote-<pid>         │   │
│  └────────────────────────────────────────────┘   │
│         │ PTY writes                  │ IPC       │
│         ▼                            ▼           │
│  ┌─────────────┐            ┌─────────────────┐ │
│  │ claude.exe  │            │ Daemon          │ │
│  │             │            │  Discord client │ │
│  │             │            │  JSONL watcher  │ │
│  │             │            │  Handlers       │ │
│  └─────────────┘            └─────────────────┘ │
│                                                      │
└─────────────────────────────────────────────────────┘
```

## Error Handling Strategy

- **Graceful degradation**: If Discord send fails, fall back to console logging
- **Retry logic**: Limited retry for transient Discord API errors
- **Message caching**: Store Discord message IDs for edits/deletes
- **IPC timeouts**: Hook scripts timeout after 5 seconds
- **Daemon restart**: If session changes, restart daemon automatically

## Extensibility Points

1. **New providers**: Implement `OutputProvider`/`ThreadCapable`/`InputCapable`
2. **New handlers**: Extend `MessageHandler`, register in `createPipeline()`
3. **New slash commands**: Add to `src/slash-commands.ts`, register on startup
4. **New message types**: Extend `jsonl-parser.ts` → add `ProcessedMessage` type

## Constraints & Assumptions

- **Platform**: Windows primary (claude.exe path hardcoded)
- **Single session per daemon**: One Discord channel per Claude session
- **Transcript location**: Fixed path in `~/.claude/transcripts/`
- **Discord bot**: Must be pre-configured with proper intents
