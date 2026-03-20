# Technology Stack

## Languages & Runtime

- **Primary Language**: TypeScript (strict mode enabled)
- **ECMAScript Target**: ES2022
- **Node.js Version**: 18+ (required by discord.js 14)
- **Module System**: ESNext with Node16 resolution (`type: "module"`)
- **Package Manager**: npm (published globally)

## Build System

- **Compiler**: TypeScript (`tsc`)
- **Source Directory**: `src/` (30 files, ~5000 LOC)
- **Output Directory**: `dist/` (gitignored)
- **Build Command**: `npm run build` → `tsc`
- **TypeScript Config** (`tsconfig.json`):
  - `strict: true` (all type checking enabled)
  - `declaration: true` (generates `.d.ts` files)
  - `sourceMap: true` (debugging support)
  - `esModuleInterop: true` (CommonJS interop)
  - `skipLibCheck: true` (faster builds)

## Production Dependencies

| Package | Version | Purpose |
|---------|---------|---------|
| `@clack/prompts` | ^1.1.0 | Interactive CLI: task lists, spinners, input prompts |
| `chokidar` | ^4.0.3 | File system watcher (JSONL transcript monitoring) |
| `discord.js` | ^14.18.0 | Discord bot client (REST + WebSocket) |
| `node-pty` | ^1.0.0 | Pseudo-terminal for spawning `claude.exe` |
| `picocolors` | ^1.1.1 | Lightweight terminal color formatting |

## Development Dependencies

| Package | Version | Purpose |
|---------|---------|---------|
| `typescript` | ^5.8.2 | TypeScript compiler and type checker |
| `@types/node` | ^22.13.10 | Node.js built-in type definitions |

## Project Structure

```
claude-remote/
├── src/
│   ├── cli.ts              # CLI entry point (setup, uninstall, update, run)
│   ├── rc.ts               # Parent process: PTY + named pipe server
│   ├── daemon.ts           # Discord bot, JSONL watcher, handler pipeline
│   ├── remote-cmd.ts       # IPC client for /remote skill
│   ├── activity.ts         # Idle/busy state manager (2-minute timeout)
│   ├── provider.ts         # Provider abstraction interfaces
│   ├── pipeline.ts         # HandlerPipeline class
│   ├── create-pipeline.ts  # Handler registration in priority order
│   ├── jsonl-parser.ts     # Parse Claude JSONL → ProcessedMessage
│   ├── format-tool.ts      # Tool name/input formatting utilities
│   ├── slash-commands.ts   # Discord slash command registration
│   ├── utils.ts            # Shared constants & helpers
│   ├── handlers/
│   │   ├── thinking.ts     # Thinking indicator show/hide
│   │   ├── plan-mode.ts    # Plan mode status embed updates
│   │   ├── tasks.ts        # Task progress boards (pinned)
│   │   ├── passive-tools.ts# Read/Grep/Glob grouping (boring tools)
│   │   ├── tool-result.ts  # Tool result routing (inline/thread)
│   │   ├── edit-write.ts   # File edit/creation diff display
│   │   ├── tool-use.ts     # General tool calls (buttons, threads)
│   │   ├── default.ts      # Fallback message rendering
│   │   └── tool-state.ts   # Shared tool state tracking
│   └── providers/
│       └── discord.ts      # Discord provider implementation
├── dist/                   # Compiled JavaScript (not repo'd)
├── assets/                 # Static files (preview.png)
├── .github/workflows/      # CI/CD (publish on release)
├── package.json            # Manifest
├── tsconfig.json           # TypeScript configuration
├── README.md               # User documentation
└── CONTRIBUTING.md         # Contribution guidelines

```

## Configuration & State

### User Configuration

- **Config file**: `~/.claude/claude-remote/config.json`
  ```json
  {
    "discordBotToken": "...",
    "guildId": "...",
    "categoryId": "..."
  }
  ```

- **Settings modified**: `~/.claude/settings.json`
  - Adds `statusLine` (command showing remote sync status)
  - Adds hooks: `SessionStart`, `Stop`, `PostCompact`

### Installed Artifacts

- **Skill**: `~/.claude/skills/remote/SKILL.md` (enables `/remote` command)
- **Hook scripts** (in package dir, referenced from settings):
  - `session-hook.js` – Registers session with parent process
  - `state-hook.js` – Updates activity state on Stop/PostCompact
- **Statusline script**: Dynamic command showing "● Remote: ON/OFF"

### Runtime State

- **Pipe registry**: `~/.claude/claude-remote/pipe-registry/` (JSON metadata for named pipes)
- **Status flag**: `~/.claude/claude-remote/status` (enabled/disabled marker)
- **Transcript**: `~/.claude/transcripts/<session-id>.jsonl` (watched by daemon)
- **Named pipe**: Windows only – `\\.\pipe\claude-remote-<pid>`

## Key Technologies & Patterns

1. **PTY Bridge**: Spawns `claude.exe` in pseudo-terminal (`node-pty`), forwards stdin/stdout, and sends simulated keystrokes for Discord → Claude interactions.

2. **Multi-Process Architecture**:
   - **Parent** (`rc.ts`): PTY management, named pipe server, stdin/stdout forwarding
   - **Daemon** (`daemon.ts`): Discord client, JSONL watcher, message handlers
   - **Controller** (`remote-cmd.ts`): IPC client for `/remote` skill

3. **JSONL Streaming**: Claude Code writes structured JSONL; daemon tails file via `chokidar`, parses messages, routes through handler pipeline.

4. **Provider Abstraction** (`provider.ts`):
   - `OutputProvider`: send/edit/delete/pin messages
   - `ThreadCapable` (optional): thread management
   - `InputCapable` (optional): receive user interactions
   - Current implementation: `DiscordProvider` (full features)

5. **Handler Pipeline** (`pipeline.ts`): Chain of responsibility with priority:
   - Thinking → Plan Mode → Tasks → Passive Tools → Tool Results → Edits → Tool Use → Default

6. **Discord Rich Integration**:
   - Buttons (Allow/Deny for tool approvals)
   - Select menus (multi-choice, file selection)
   - Modals (text forms)
   - Threads (long conversations)
   - Slash commands (`/mode`, `/status`, `/stop`, `/clear`, `/compact`, `/queue`)
   - Embeds with syntax-highlighted diffs
   - Pinned task boards with progress bars

7. **Rate Limiting**: DiscordProvider enforces 5 messages per 5-second sliding window; caches up to 80 messages and 40 threads (LRU).

8. **Activity Detection**: 2-minute inactivity timeout transitions state to "idle" for statusline.

## Platform Support

- **Primary**: Windows (Claude Code desktop app uses `claude.exe`)
- **Not supported**: macOS/Linux (README explicitly states)
- **Terminal**: Windows Terminal, ConPTY; PowerShell 5/7, Git Bash, CMD shim detection

## Code Quality & Safety

- **Type Safety**: Full TypeScript strict mode (no `any` in core)
- **Error Handling**: Graceful degradation – Discord failures fall back to console logging; best-effort cleanup; silent swallow of expected errors (edit/delete on missing messages)
- **Logging Convention**: Prefixes: `[daemon]`, `[rc]`, `[activity]`, `[discord]`
- **Security Note**: Bot token stored in plaintext (local tool), passed via environment to daemon.

## Distribution

- **NPM package**: `@hoangvu12/claude-remote` (public)
- **Binaries**: `claude-remote`, `remote-cmd`
- **Repository**: https://github.com/hoangvu12/claude-remote.git
- **License**: MIT
- **Auto-update**: Built-in (`claude-remote update`) checks npm registry

## External Service Dependencies

- **Discord API**: REST + WebSocket (gateway v10)
- **NPM Registry**: For version checks and self-update
- **Claude Code**: Requires installed Claude Code desktop (Windows)

## Technology Debt Signals

- ❌ No automated tests (manual integration only)
- ❌ Windows-only platform (hardcoded `claude.exe`, ConPTY escape sequences)
- ⚠️ `execSync` used in update & alias install (shell injection risk if inputs compromised)
- ⚠️ Global mutable state in daemon (hard to test)
- ⚠️ Magic numbers scattered (BATCH_DELAY=600, KEY_DELAY=150, cache sizes)
- ⚠️ Inconsistent error handling patterns
- ⚠️ Unbounded UUID sets (memory growth over time)
- ⚠️ No backpressure on message bursts (rate limit risk)
