# Architecture

## High-Level Overview

`claude-remote` bridges Claude Code (terminal AI) with Discord via a multi-process architecture. It spawns Claude in a PTY, captures its JSONL transcript, and streams it to Discord with rich interactive elements. User interactions in Discord are translated back into PTY keystrokes.

### Process Model

```
┌──────────────┐
│   Terminal   │
│   User runs  │
│ claude-remote│
└──────┬───────┘
       │ exec
       ▼
┌─────────────────────────────────────────────────────────┐
│ Parent Process (rc.js)                                   │
│                                                          │
│  • Spawns claude.exe via node-pty                        │
│  • Creates named pipe server                             │
│  • Forwards PTY I/O to terminal                          │
│  • Forwards daemon IPC → PTY writes                     │
│  • Handles signals (SIGINT) and cleanup                 │
└─────────────────────────────────────────────────────────┘
       │ fork
       ▼
┌─────────────────────────────────────────────────────────┐
│ Daemon Process (daemon.js)                               │
│                                                          │
│  • Discord.js client (WebSocket + REST)                 │
│  • chokidar watcher on JSONL transcript                 │
│  • jsonl-parser → ProcessedMessage                      │
│  • HandlerPipeline (chain of responsibility)            │
│  • DiscordProvider (send/edit/threads/interactions)     │
└─────────────────────────────────────────────────────────┘
       │ Discord gateway
       ▼
   Discord Servers
```

**Why two processes?**

- **Separation of concerns**: PTY blocking I/O vs Discord event loop (though both Node, separation prevents interference).
- **Crash isolation**: Discord bot crash doesn't kill Claude PTY (and vice versa).
- **Lifecycle independence**: Daemon can restart without killing Claude (session changes).
- **Windows constraints**: PTY and Discord both use event loops; splitting simplifies.

**IPC**: Named pipes on Windows (`\\.\pipe\claude-remote-<pid>`). Daemon connects on `session-register`; parent sends `pty-write` for key simulation.

## Core Components

### 1. CLI (`src/cli.ts`)

Entry point for `claude-remote` command.

**Subcommands**:
- `setup` – Interactive wizard: Discord bot token, server selection, category creation, install hooks/skill/statusline, optional shell alias.
- `uninstall` – Remove all traces: skill, hooks, statusline, config, aliases.
- `update` – Check npm registry, install latest version globally.
- `start` (default) – Spawn parent process (`rc.js`) and exit.

**Responsibilities**:
- Config management (`~/.claude/claude-remote/config.json`)
- Discord API helpers (validate token, fetch guilds, create category)
- Install/uninstall hooks & statusline into `~/.claude/settings.json`
- Install `/remote` skill
- Shell alias installation (PowerShell, Git Bash, CMD shim)

### 2. Parent / PTY Manager (`src/rc.ts`)

**Process**: Forked by CLI; not a long-running daemon (replaces CLI process).

**Responsibilities**:
- Spawn `claude.exe` via `node-pty` with appropriate env vars
- Create named pipe server for daemon IPC
- Forward PTY output to terminal stdout
- Forward terminal stdin to PTY (user typing)
- Handle terminal resize (send to PTY)
- On PTY exit: restore terminal state, stop daemon, cleanup pipe, exit

**IPC handling** (`socket.on("data")`):
- `session-register`: Store session ID, transcript path; restart daemon if needed.
- `enable`/`disable`: Control remote sync (toggle daemon on/off)
- `pty-write`: Write keystrokes to PTY (e.g., for Approve/Deny simulation)
- `state-signal`: Update activity (idle/busy)

**State (module-level)**:
- `sessionId`, `transcriptPath`, `projectDir`
- `daemon` process handle
- `daemonWasEnabled`
- `lastChannelId` (for reuse)

**Terminal hack**: On Windows, ConPTY leaves terminal in raw mode after exit; explicit `setRawMode(false)` and escape sequence `\x1b[?9001l` to restore.

### 3. Daemon (`src/daemon.ts`)

**Process**: Forked from parent; runs independently.

**Startup**:
- Reads `DISCORD_BOT_TOKEN`, `DISCORD_GUILD_ID`, `DISCORD_CATEGORY_ID` from env
- Creates `DiscordProvider` (logs in to Discord)
- Starts `chokidar` watcher on transcript file
- Registers slash commands (fire-and-forget)
- Creates/reuses channel based on session name
- Initializes `HandlerPipeline`

**Main Loop** (`watcher.on("change")`):
1. Read new lines from transcript (byte offset tracking)
2. Parse each line with `jsonl-parser`
3. Create `ProcessedMessage` (normalized)
4. Debounce (batch) for 600ms to reduce API calls
5. Flush batch → `handlerPipeline.process()`
6. Each handler may send to Discord via `provider`; return `"consumed"` to stop.

**State (module-level)**:
- `sessionId`, `projectDir`, `jsonlPath`
- `provider` (DiscordProvider)
- `watcher` (FSWatcher)
- `ctx` (SessionContext shared with handlers)
- `pipeline` (HandlerPipeline)
- `pendingBatch`, `batchTimer`, `flushPromise`
- `processedUuids` / `knownUuids` (deduplication sets)
- `lastFileSize` (for tailing)

**IPC Commands from Parent**:
- `state-signal` → transition activity to idle (on Stop/Compact)
- `interaction` → respond to Discord interactions
- `signal` → send signal to PTY (Ctrl+C)

**Shutdown** (`stopDaemon()`):
- Destroy provider (close Discord connection)
- Destroy pipeline (handler cleanup)
- Close watcher
- Kill daemon process (if forked from parent)

### 4. JSONL Parser (`src/jsonl-parser.ts`)

**Purpose**: Convert raw JSONL lines from Claude into `ProcessedMessage` objects used by handlers.

**Input**: Each line is a JSON object from Claude Code's transcript.

**Processing**:
- Identify message type (`user`, `assistant`, `system`, `tool-result`, `file-edit`, etc.)
- Extract `content` blocks (text, tool_use, tool_result, image)
- Normalize fields: `id`, `type`, `text`, `tool`, `input`, `output`, `cached`, `delta`, `fileEdits`, `attachments`, `thinking`, `planMode`, etc.
- `processUserBlocks()`, `processAssistantBlocks()`, `processNonConversation()` route by role.
- Build `ProcessedMessage` with convenient properties for handlers.

**Key functions**:
- `parseJSONLString(jsonl: string): ProcessedMessage[]`
- `walkCurrentBranch(watcher, startSize, onLines)`: Read transcript tail efficiently.
- `processAssistantBlocks(blocks)`: Extract tool use, thinking, image blocks.

### 5. Handler Pipeline (`src/pipeline.ts`, `src/create-pipeline.ts`)

**Pattern**: Chain of Responsibility.

```typescript
class HandlerPipeline {
  private handlers: MessageHandler[] = [];

  register(handler: MessageHandler): void;
  init(ctx: SessionContext): void;
  async process(pm: ProcessedMessage, ctx: SessionContext): Promise<void>;
  destroy(): void;
}
```

**Handler interface**:

```typescript
type MessageHandler = {
  types?: string[];        // message types this handler cares about
  init?(ctx: SessionContext): void;
  handle(pm: ProcessedMessage, ctx: SessionContext): Promise<"consumed" | "pass">;
  destroy?(): void;
};
```

**Registration order** (priority):

1. `ThinkingHandler` – Shows/hides "Claude is thinking..." indicator based on thinking-start/end.
2. `PlanModeHandler` – Posts pinned embed on EnterPlanMode, clears on ExitPlanMode.
3. `TaskHandler` – Creates/updates pinned task progress board.
4. `PassiveToolHandler` – Groups boring tools (Read, Grep, Glob, Glob) inline or summarized thread.
5. `ToolResultHandler` – Routes tool-result messages: inline if trivial, thread if large, edit if file.
6. `EditWriteHandler` – Renders file edits as code blocks with syntax-highlighted diffs.
7. `ToolUseHandler` – Other tool calls (non-passive): renders embed with Allow/Deny buttons; escalates to thread if >5k chars.
8. `DefaultHandler` – Fallback: renders any message (user/assistant text) via `renderMessage()`.

**Handler decisions**:
- Return `"consumed"` to stop pipeline.
- Return `"pass"` (or undefined) to let later handlers run.

**Context** (`SessionContext`): Shared mutable state passed to all handlers:

```typescript
interface SessionContext {
  provider: DiscordProvider;
  channel: TextChannel;
  isEnabled: boolean;
  isBusy: boolean;
  taskBoardHandle: ProviderMessage | null;
  passiveGroup: PassiveGroup | null;         // for bundling passive tools
  activeThreads: Map<string, ProviderThread>; // thread cache
  onInteraction?(interaction: ProviderInteraction): Promise<boolean>;
}
```

### 6. Provider Abstraction (`src/provider.ts`)

**Goal**: Decouple core logic from Discord specifics, enabling future providers (Telegram, Slack, web UI).

**Interfaces**:

- `OutputProvider` (required):
  - `send(msg: OutgoingMessage): Promise<ProviderMessage | null>`
  - `edit(handle, msg)`
  - `delete(handle)`
  - `pin(handle)`
  - `destroy(): Promise<void>`

- `ThreadCapable` (optional):
  - `createThread(name)`
  - `sendToThread(thread, msg)`
  - `renameThread(thread, name)`
  - `archiveThread(thread)`

- `InputCapable` (optional):
  - `onUserMessage(cb)`
  - `onInteraction(cb)`
  - `respond(interaction, msg)`

**DiscordProvider** (`src/providers/discord.ts`) implements all three.

### 7. DiscordProvider

**Responsibilities**: Translate internal `OutgoingMessage` → Discord.js calls; receive Discord events; enforce rate limits; cache messages/threads.

**Key fields**:
- `client: Client` (discord.js)
- `channel: TextChannel` (session channel)
- `messageTimes: number[]` (rate limit timestamps)
- `messageCache: Map<string, Message>` (LRU up to 80)
- `threadCache: Map<string, ThreadChannel>` (LRU up to 40)
- `userMessageCb`, `interactionCb` (callbacks for incoming)

**Rate limiting** (5/5s sliding window):
```typescript
messageTimes = messageTimes.filter(t => Date.now() - t < 5000);
if (messageTimes.length >= 5) {
  await delay(5000 - (Date.now() - messageTimes[0]));
}
messageTimes.push(Date.now());
```

**Message sending** (`send()`):
- Build `MessageCreateOptions` from `OutgoingMessage`:
  - `content` (text fallback)
  - `embeds` (rich formatting)
  - `components` (buttons/select menus)
  - `files` (attachments)
  - `reply` to pinned task board (special)
- Apply rate limit
- Cache sent message (for later edit/delete)
- Return `{ id: message.id }` handle.

**Thread management**:
- `createThread(name)` – Creates thread under channel, caches.
- `sendToThread(thread, msg)` – Sends message to thread.
- `archiveThread(thread)` – Archives, removes from cache.

**Interactions**:
- `onInteraction` – Emits to `interactionCb` with `ProviderInteraction` (type, customId, values, ref).
- `respond(interaction, msg)` – Sends response (ephemeral or followup).

**Event listeners** (registered in constructor):
- `Events.MessageCreate` → `handleMessage()` (currently unused, reserved for user message callbacks)
- `Events.InteractionCreate` → `handleInteraction()` → callback

## Data Flow

### Outbound: Claude → Discord

```
Claude writes JSONL
    ↓ (chokidar change event)
daemon.ts reads new lines
    ↓ (parseJSONLString)
ProcessedMessage[]
    ↓ (debounce 600ms)
HandlerPipeline.process(msg)
    ↓ (handler calls)
ctx.provider.send(msg)
    ↓ (DiscordProvider: rate limit, build embed, cache)
Discord API (HTTP POST)
    ↓
User sees message in channel
```

### Inbound: Discord → Claude

```
User clicks button / selects / submits modal
    ↓ (Discord.js)
DiscordProvider.handleInteraction()
    ↓ (convert to ProviderInteraction)
ctx.onInteraction?.(interaction)
    ↓ (daemon: send response HTTP, maybe IPC)
IPC to parent (pty-write with keystrokes)
    ↓
Parent writes to PTY
    ↓
Claude receives simulated keys
    ↓
Claude acts (approves, selects option, etc.)
```

### Tool Approval Flow

1. `ToolUseHandler` renders tool call embed with "Allow" and "Deny" buttons.
2. Buttons have customId: `Allow-Deny-<uuid>` / `Deny-Deny-<uuid>`.
3. User clicks → `DiscordProvider.handleInteraction()` → extracts `uuid` and intent.
4. Daemon responds to interaction (defer to acknowledge).
5. Sends IPC to parent with `{ type: "enable" }` (if needed) and `pty-write` sequence: space, arrow-down(s), enter.
6. Parent simulates keystrokes → Claude's select menu receives input.
7. Tool proceeds (or is denied).
8. Handler may update embed to show result.

## Entry Points Summary

| File | Entry | Process | Command |
|------|-------|---------|---------|
| `src/cli.ts` | `main()` | Parent (initial) | `claude-remote [subcommand]` |
| `src/rc.ts` | `start()` | Parent (forked) | invoked by CLI |
| `src/daemon.ts` | `start()` | Daemon (forked) | invoked by parent |
| `src/remote-cmd.ts` | `main()` | Controller | `remote-cmd [status\|on\|off\|...]` |

## State Management

**Global mutable state** (single-threaded Node, acceptable but not ideal for testing):
- In `daemon.ts`: `sessionId`, `watcher`, `processedUuids`, `pendingBatch`, etc.
- In `rc.ts`: `sessionId`, `daemon`, pipe server.

**Shared context** (`SessionContext`):
- Passed to handlers; mutable (e.g., `taskBoardHandle` updates).
- Allows coordination without globals (inside daemon).

**Activity Manager** (`src/activity.ts`):
- Tracks `isBusy` vs `isIdle` based on JSONL activity.
- 2-minute timeout of no new lines → `isBusy = false`.
- Used by statusline script to show "●" or "○".
- Emits events to `state-hook` for Claude Code integration.

## Error Handling Strategy

- **Graceful degradation**: If Discord send fails, log error and continue; don't crash.
- **Best effort cleanup**: `finally` blocks for watcher close, provider destroy.
- **Silent failures for expected errors**: `message.edit()` may fail if message deleted → ignore.
- **Top-level catch**: Daemon and parent have `process.on("unhandledRejection")` / `uncaughtException`? (Not explicitly set – leaves default crash for unexpected).
- **IPC timeouts**: Hook scripts have 5s timeout (settings.json); pipe client has 3s timeout.

## Extensibility Points

1. **Add new message type**: Extend `jsonl-parser.ts` to recognize and populate `ProcessedMessage` fields.
2. **Add new handler**: Implement `MessageHandler`, register in `createPipeline()`.
3. **Add new provider**: Implement `OutputProvider`/etc., instantiate based on config.
4. **Add new slash command**: Add to `src/slash-commands.ts`, call from daemon startup.
5. **Change batching**: Adjust `BATCH_DELAY` in `daemon.ts`.
6. **Change rate limits**: Adjust `RATE_WINDOW` and `RATE_LIMIT` in `DiscordProvider`.

## Constraints & Assumptions

- **Platform**: Windows only (hardcoded `claude.exe`, ConPTY).
- **Single session per daemon**: One Discord channel per Claude session.
- **Transcript path**: Fixed pattern `~/.claude/transcripts/<session-id>.jsonl`.
- **Discord bot**: Must have proper intents and permissions; belongs to user.
- **Node.js**: 18+ (discord.js requirement).
- **Claude Code**: Desktop app (Windows), not CLI version.

## Performance Considerations

- **Batching**: 600ms debounce reduces Discord API calls (~10 messages → 1 batch).
- **Rate limiting**: Prevents hitting Discord limits but may drop excess messages (not implemented – currently throttles).
- **Caching**: LRU caches prevent extra fetches; bounded memory.
- **Chokidar**: Efficient tailing (seeks to last known position, reads delta).
- **Set lookups**: `processedUuids` O(1) deduplication (but grows unbounded).

## Security Architecture

- **Bot token**: Stored in plaintext in `config.json` (0600 not enforced). Consider OS keyring future.
- **IPC pipe**: No authentication; local process could send commands. Threat model: local user already has full access.
- **User input**: Not sanitized – trusted (Claude output is rendered as code blocks/embeds; Discord interactions validated by Discord.js).
- **Shell exec**: `execSync` used for PowerShell detection and self-update. Only runs controlled commands.

## Observability

- **Console logs**: Prefixed `[daemon]`, `[rc]`, `[activity]`, `[discord]`.
- **Statusline**: Claude Code status bar shows Remote: ON/OFF (via command output).
- **Discord channel**: Visual feedback for all outputs; errors logged to channel if fallback.
- **No metrics export**: No Prometheus/statsd.
- **No structured logs**: Simple `console.log` only.

## Future Architectural Improvements

- **Single-process redesign**: Could merge parent and daemon by disentangling Discord.js from PTY (maybe worker threads). Current split is pragmatic but not necessary.
- **Message queue**: Decouple processing from delivery (backpressure).
- **Persistent session store**: Save/restore state across restarts (tasks, thread cache).
- **Webhook provider**: Send Claude output to arbitrary HTTP endpoints.
- **Management API**: Local HTTP server for control (instead of named pipes).
- **Configuration validation**: Schema for `config.json`.

## Diagrams

### Message Flow (Simplified)

```
┌─────────┐
│ Claude  │
│  Code   │ writes JSONL
└────┬────┘
     │ tail
     ▼
┌─────────┐
│  PTY    │ ← stdin from user typing
│ wrapper │
└────┬────┘
     │ IPC
     ▼
┌─────────┐
│  Daemon │ parse → handlers → provider
└────┬────┘
     │ Discord API
     ▼
┌─────────┐
│ Discord │ ← user clicks → interactions
└─────────┘
```

### Handler Pipeline

```
ProcessedMessage
    │
    ▼
┌──────────────────┐
│ ThinkingHandler  │  (thinking-start/end?)
└──────────────────┘
    │ consumed? no
    ▼
┌──────────────────┐
│ PlanModeHandler  │  (enter/exit-plan-mode?)
└──────────────────┘
    │ consumed? no
    ▼
┌──────────────────┐
│   TaskHandler    │  (task-start/end?)
└──────────────────┘
    │ consumed? no
    ▼
┌──────────────────┐
│ PassiveToolHndlr │  (tool-result with Read/Grep/Glob?)
└──────────────────┘
    │ consumed? no
    ▼
┌──────────────────┐
│ ToolResultHndlr  │  (tool-result?)
└──────────────────┘
    │ consumed? no
    ▼
┌──────────────────┐
│ EditWriteHandler │  (file-edit?)
└──────────────────┘
    │ consumed? no
    ▼
┌──────────────────┐
│  ToolUseHandler  │  (tool-use?)
└──────────────────┘
    │ consumed? no
    ▼
┌──────────────────┐
│ DefaultHandler   │  (everything else)
└──────────────────┘
    │
    ▼
   DONE
```

---

**Last reviewed**: 2026-03-20
