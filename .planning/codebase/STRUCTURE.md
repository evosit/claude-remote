# Directory Structure & Key Locations

## Top-Level Layout

```
claude-remote/
├── src/                    # TypeScript source (~5000 LOC)
│   ├── cli.ts             # CLI entry point (setup, uninstall, update, run)
│   ├── rc.ts              # Parent process: PTY + named pipe server
│   ├── daemon.ts          # Discord bot + JSONL watcher
│   ├── remote-cmd.ts      # IPC client for /remote skill
│   ├── activity.ts        # Idle/busy state manager
│   ├── provider.ts        # Provider interface definitions
│   ├── pipeline.ts        # HandlerPipeline class
│   ├── create-pipeline.ts # Pipeline construction
│   ├── jsonl-parser.ts    # Claude JSONL parsing
│   ├── format-tool.ts     # Tool name/input formatting
│   ├── slash-commands.ts  # Discord slash command registration
│   ├── rc.js              # Compiled parent (in dist/ after build)
│   ├── ...                # Other compiled files
│   ├── handlers/          # Message type handlers
│   │   ├── thinking.ts    # Thinking indicator show/hide
│   │   ├── plan-mode.ts   # Plan mode status embed
│   │   ├── tasks.ts       # Task progress boards
│   │   ├── passive-tools.ts # Read/Grep/Glob grouping
│   │   ├── tool-result.ts # Tool result routing
│   │   ├── edit-write.ts  # File edit display
│   │   ├── tool-use.ts    # General tool calls
│   │   ├── default.ts     # Fallback message rendering
│   │   └── tool-state.ts  # Shared tool state tracking
│   ├── providers/         # Platform-specific implementations
│   │   └── discord.ts     # Discord bot provider
│   └── utils.ts           # Shared utilities
├── dist/                  # Compiled JavaScript (gitignored)
├── assets/                # Static files (preview.png)
├── .github/               # GitHub workflows
│   └── workflows/
│       └── publish.yml   # npm publish on release
├── package.json           # Dependencies, scripts, bin links
├── tsconfig.json          # TypeScript compiler config
├── README.md              # Documentation
└── CONTRIBUTING.md        # Contribution guidelines
```

## Key Source Files

### Process Entry Points

| File | Role | Process |
|------|------|---------|
| `src/cli.ts` | Command-line interface | Parent (initial) |
| `src/rc.ts` | PTY + pipe server | Parent (forked) |
| `src/daemon.ts` | Discord bot | Daemon (forked) |
| `src/remote-cmd.ts` | IPC client | Controller (ad-hoc) |

### Core Modules

- **`src/provider.ts`** – Abstraction for output/input providers (Discord, future platforms)
- **`src/pipeline.ts`** – HandlerPipeline chain-of-responsibility implementation
- **`src/create-pipeline.ts`** – Registers all handlers in priority order
- **`src/jsonl-parser.ts`** – Parses Claude's JSONL transcript → internal `ProcessedMessage`
- **`src/utils.ts`** – Constants (`CONFIG_DIR`, `ID_PREFIX`, etc.), misc helpers

### Handlers (`src/handlers/`)

Each handler processes specific message types:

| Handler | Message Types | Output Location | Notes |
|---------|--------------|-----------------|-------|
| `thinking.ts` | `thinking-start/end` | Status indicator | Shows "Claude is thinking..." |
| `plan-mode.ts` | `enter-plan-mode`/`exit-plan-mode` | Pinned embed | When Claude enters planning mode |
| `tasks.ts` | `task-start`/`task-end` | Pinned board | Progress bar, dynamic updates |
| `passive-tools.ts` | tool results (boring tools) | Grouped inline or thread | Read, Grep, Glob bundling |
| `tool-result.ts` | `tool-result` (routing) | Destination selection | Decides inline vs thread vs edit |
| `edit-write.ts` | `file-edit` | Inline code block | Shows diffs for Edit/Write |
| `tool-use.ts` | `tool-use` (non-passive) | Inline embed | Buttons, long outputs → thread |
| `default.ts` | All others | Standard message | Fallback rendering |

Handler order is critical – early handlers can "consume" messages, stopping further processing.

### Provider (`src/providers/`)

- **`discord.ts`** – Full Discord implementation
  - Rate limiting (5/5s)
  - Caches (80 messages, 40 threads)
  - Thread creation/archival
  - Button/select/modal interactions
  - Embed building (rich formatting)

## Configuration Files

### User Configuration

- `~/.claude/claude-remote/config.json`
  ```json
  {
    "discordBotToken": "...",
    "guildId": "...",
    "categoryId": "..."
  }
  ```

### Claude Code Settings

- `~/.claude/settings.json` (modified by install)
  ```json
  {
    "statusLine": { "type": "command", "command": "node \".../statusline.js\" " },
    "hooks": {
      "SessionStart": [{ "matcher": "", "hooks": [{ "type": "command", "command": "node \".../session-hook.js\"", "timeout": 5000 }] }],
      "Stop": [...],
      "PostCompact": [...]
    }
  }
  ```

### Installed Skills & Hooks

- Skill: `~/.claude/skills/remote/SKILL.md` (enables `/remote` command)
- Hook scripts (installed by `cli.ts`):
  - `session-hook.js` – Registers session ID with parent
  - `state-hook.js` – Updates activity/idle state
  - (legacy) `discord-hook.js`

These files live alongside the package in `node_modules/@hoangvu12/claude-remote/` and are copied during install.

## Generated Files

- `statusline.js` – Outputs remote status as single line (``● Remote: ON``/`OFF`)
- Written to temp location per-platform (see `cli.ts:getStatuslineCommand()`)

## Named Pipe Convention

- Pattern: `\\.\pipe\claude-remote-<pid>`
- Parent creates server; daemon connects via `CLAUDE_REMOTE_PIPE` environment var
- SessionStart hook reads this env var to find the pipe

## JSONL Transcript Location

- Default: `~/.claude/transcripts/<session-id>.jsonl`
- Override via `transcriptPath` in session-register message
- Daemon tails this file; `chokidar` watches for changes

## Build & Output

### Compilation

```bash
npm run build
# TypeScript → dist/
```

- `tsconfig.json`: `outDir: "dist"`, `rootDir: "src"`
- All `.ts` files compile to `.js` preserving structure
- Generates `.d.ts` declaration files

### Binaries

After install (`npm install -g @hoangvu12/claude-remote`):

- `claude-remote` → `.../node_modules/@hoangvu12/claude-remote/dist/cli.js`
- `remote-cmd` → `.../node_modules/@hoangvu12/claude-remote/dist/remote-cmd.js`

Controlled by `package.json` `bin` field.

## Naming Conventions

- **Files**: kebab-case (e.g., `jsonl-parser.ts`, `plan-mode.ts`)
- **Classes**: PascalCase (e.g., `DiscordProvider`, `HandlerPipeline`)
- **Functions/variables**: camelCase
- **Constants**: UPPER_SNAKE_CASE (e.g., `MAX_MESSAGE_CACHE`, `BATCH_DELAY`)
- **Types/interfaces**: PascalCase (e.g., `ProcessedMessage`, `ProviderMessage`)
- **Discord custom IDs**: PascalCase with dashes (e.g., `Allow-Deny-<uuid>`, `Select-<tool>-<uuid>`)

## Module Boundaries

Core layers (from low to high):

1. **OS/Network**: `node-pty`, `net` (pipes), `chokidar`, `fs`
2. **External APIs**: `discord.js`
3. **Provider**: `providers/discord.ts` (raw Discord → internal interfaces)
4. **Parsing**: `jsonl-parser.ts` (JSONL → ProcessedMessage)
5. **Handling**: `handlers/*` (rendering logic)
6. **Pipeline**: `pipeline.ts`, `create-pipeline.ts` (orchestration)
7. **Process management**: `rc.ts`, `daemon.ts` (lifecycle, IPC)
8. **CLI**: `cli.ts` (user-facing commands, setup)

Dependencies flow downward only (upper layers depend on lower, not vice versa).
