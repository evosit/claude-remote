# Code Conventions

## Core Principles

- **TypeScript strict mode** everywhere
- **Node16 ESM modules** with explicit `.js` extensions
- **Error resilience**: Graceful degradation, never crash on external API failures
- **Logging prefixes**: `[daemon]`, `[rc]`, `[activity]`, `[discord]`
- **Provider abstraction**: Platform-agnostic interfaces for output/input

## Structure Patterns

### Files & Naming

- kebab-case: `jsonl-parser.ts`, `plan-mode.ts`
- PascalCase: Classes (`DiscordProvider`), Interfaces (`ProcessedMessage`)
- camelCase: functions/vars (`createPipeline()`, `watcher`)
- UPPER_SNAKE_CASE: Constants (`MAX_MESSAGE_CACHE`, `BATCH_DELAY`)

### Process Boundaries

```
cli (setup/install)
  ↓ forked
rc (PTY management + pipe server)
  ↓ forks
daemon (Discord + JSONL watcher)
  ↓ spawns
remote-cmd (IPC client from /remote skill)
```

### Data Flow

Claude JSONL → `jsonl-parser` → `ProcessedMessage` → `HandlerPipeline` → `DiscordProvider` → Discord

User Discord interactions → `DiscordProvider` → IPC → PTY keystrokes → Claude

## Handler Pipeline Order

(see `src/create-pipeline.ts`)

1. `ThinkingHandler` – show/hide "thinking..."
2. `PlanModeHandler` – Enter/Exit plan mode status
3. `TaskHandler` – pinned task board (before other tools)
4. `PassiveToolHandler` – Read/Grep/Glob (boring)
5. `ToolResultHandler` – route tool results
6. `EditWriteHandler` – file edit diffs
7. `ToolUseHandler` – other tools (buttons, threads)
8. `DefaultHandler` – fallback message render

Each returns `"consumed"` or `"pass"` (continue to next handler).

## State Sharing

`SessionContext` passed to handlers:

```typescript
interface SessionContext {
  provider: DiscordProvider;
  channel: TextChannel;
  isEnabled: boolean;
  isBusy: boolean;
  taskBoardHandle: ProviderMessage | null;
  passiveGroup: PassiveGroup | null;
  activeThreads: Map<string, ProviderThread>;
  // callbacks
  onInteraction?: (interaction) => void;
}
```

## Constants & Paths

Centralized in `src/utils.ts`:

- `CONFIG_DIR` – `~/.claude/claude-remote`
- `ID_PREFIX` – "`claude-remote-`"
- `STATUS_FLAG` – file for process status
- `PIPE_REGISTRY` – directory for pipe metadata

Never hardcode these paths.

## Provider Interface Contract

**OutputProvider** (required):

- `send(msg)` → `{ id }`
- `edit(handle, msg)`
- `delete(handle)`
- `pin(handle)`
- `destroy()`

**ThreadCapable** (optional):

- `createThread(name)`
- `sendToThread(thread, msg)`
- `renameThread(thread, name)`
- `archiveThread(thread)`

**InputCapable** (optional):

- `onUserMessage(cb)`
- `onInteraction(cb)`
- `respond(interaction, msg)`

DiscordProvider implements all three.

## Rate Limiting Strategy

DiscordProvider enforces **5 messages per 5 seconds**:

```typescript
const RATE_WINDOW = 5000;
const RATE_LIMIT = 5;
let messageTimes: number[] = []; // timestamps sorted ascending

// Before send:
messageTimes = messageTimes.filter(t => Date.now() - t < RATE_WINDOW);
if (messageTimes.length >= RATE_LIMIT) {
  await delay(...); // wait for window to slide
}
messageTimes.push(Date.now());
```

## Message Caching

- Messages: LRU up to 80 (for edit/delete)
- Threads: LRU up to 40 (for reuse, archival)

Implement with `Map` + array, or better LRU cache library.

## Clap (CLI)

Uses `@clack/prompts` for setup wizard:

- `p.intro()`, `p.outro()`
- `p.tasks()` – progress bars
- `p.password()`, `p.select()`, `p.confirm()`
- `p.log.step()`, `p.log.info()`, `p.log.error()`

## Cross-Platform Notes

### Windows

- `claude.exe` path hardcoded
- PTY uses ConPTY (Windows Terminal)
- Terminal restoration: `write("\x1b[?9001l")` on exit
- Shell detection: PowerShell 5, PowerShell 7/pwsh, Git Bash, CMD shim
- Named pipes: `\\.\pipe\...`

### Unix (not supported yet)

- Would need `claude` binary (no .exe)
- Different PTY handling? (node-pty works)
- No ConPTY restoration needed

## Testing Conventions

**Current**: Manual only (no automated tests).

**Future**: Unit tests for:
- `jsonl-parser.ts` (pure)
- `utils.ts` (pure)
- Individual handlers (with mocked context)

## Git Hygiene

- Commit often, small diffs
- Build before commit (`npm run build`)
- Update documentation alongside code changes
- Don't commit `dist/` (gitignored)

## Legacy Artifacts

- `discord-hook.js` – old hook name, not used but kept for migration
- `ID_PREFIX` used for custom IDs in Discord buttons
- `"discord"` skill directory removed during install (migration from old naming)
