# Directory Structure & Organization

## Top-Level Layout

```
claude-remote/
├── src/                    # Source code (TypeScript)
│   ├── cli.ts             # CLI entry point
│   ├── rc.ts              # Parent process (PTY + pipe server)
│   ├── daemon.ts          # Daemon (Discord + JSONL watcher)
│   ├── remote-cmd.ts      # IPC controller
│   ├── activity.ts        # Activity/idle state manager
│   ├── provider.ts        # Provider interfaces
│   ├── pipeline.ts        # HandlerPipeline class
│   ├── create-pipeline.ts # Handler registration
│   ├── jsonl-parser.ts    # JSONL parsing
│   ├── format-tool.ts     # Tool formatting utils
│   ├── slash-commands.ts  # Discord slash command registration
│   ├── utils.ts           # Shared constants & helpers
│   ├── handlers/          # Message handlers (chain of responsibility)
│   │   ├── thinking.ts    # Thinking indicator
│   │   ├── plan-mode.ts   # Plan mode status
│   │   ├── tasks.ts       # Task progress boards
│   │   ├── passive-tools.ts # Boring tools grouping
│   │   ├── tool-result.ts # Tool result routing
│   │   ├── edit-write.ts  # File edit display
│   │   ├── tool-use.ts    # General tool calls
│   │   ├── default.ts     # Fallback rendering
│   │   └── tool-state.ts  # Shared tool state
│   └── providers/         # Platform implementations
│       └── discord.ts     # Discord provider
├── dist/                  # Compiled JavaScript (npm package)
├── assets/                # Static assets (preview.png)
├── .github/workflows/     # CI/CD
│   └── publish.yml       # npm publish on release
├── package.json           # Manifest
├── tsconfig.json          # TypeScript config
├── README.md              # User docs
├── CONTRIBUTING.md        # Contributor guide
└── [other dotfiles]      # .gitignore, etc.
```

## Source Tree (30 files)

```
src/
├── cli.ts (774 lines) – setup, uninstall, update, run
├── rc.ts (275 lines) – parent process, PTY management
├── daemon.ts (940 lines) – Discord bot, watcher, pipeline
├── remote-cmd.ts (70 lines) – IPC client for /remote skill
├── activity.ts (130 lines) – ActivityManager (idle detection)
├── provider.ts (98 lines) – Provider interface definitions
├── pipeline.ts (30 lines) – HandlerPipeline class
├── create-pipeline.ts (26 lines) – Handler registration
├── jsonl-parser.ts (400 lines) – Claude JSONL parsing
├── format-tool.ts (70 lines) – Tool formatting utilities
├── slash-commands.ts (120 lines) – Slash command registration
├── utils.ts (200 lines) – Constants, path helpers, misc
├── handlers/
│   ├── thinking.ts (80 lines)
│   ├── plan-mode.ts (100 lines)
│   ├── tasks.ts (300 lines)
│   ├── passive-tools.ts (250 lines)
│   ├── tool-result.ts (200 lines)
│   ├── edit-write.ts (150 lines)
│   ├── tool-use.ts (350 lines)
│   ├── default.ts (200 lines)
│   └── tool-state.ts (50 lines)
├── providers/
│   └── discord.ts (550 lines)
└── [type declarations: types.ts, etc.]
```

*Line counts approximate.*

## Entry Points & Responsibilities

| File | Role | Process | Size | Maturity |
|------|------|---------|------|----------|
| `cli.ts` | Command interface, installer | Parent (initial) | 774 | Stable |
| `rc.ts` | PTY manager, pipe server | Parent (replaces CLI) | 275 | Stable |
| `daemon.ts` | Discord bot, watcher, handlers | Daemon (forked) | 940 | Stable |
| `remote-cmd.ts` | IPC client | Controller (ad-hoc) | 70 | Stable |

## Module Organization Principles

### Layer Cake (Dependency Direction)

Upper layers depend on lower, not vice versa:

```
   ┌─────────────────────────────────────┐
   │  CLI / Setup                        │
   │  (user-facing commands)             │
   ├─────────────────────────────────────┤
   │  Process Management                │
   │  (rc.ts, daemon.ts: lifecycle)     │
   ├─────────────────────────────────────┤
   │  Handlers + Pipeline               │
   │  (transform ProcessedMessage → Discord)│
   ├─────────────────────────────────────┤
   │  Provider (Discord)                │
   │  (Discord API wrapper)             │
   ├─────────────────────────────────────┤
   │  Parser (JSONL)                    │
   │  (raw → structured)                │
   ├─────────────────────────────────────┤
   │  Utils + Constants                 │
   └─────────────────────────────────────┘
          ↓ dependencies
   ┌─────────────────────────────────────┐
   │  External Libraries                │
   │  (discord.js, chokidar, node-pty) │
   └─────────────────────────────────────┘
```

### Handler Directory

Each handler is independent, implements `MessageHandler` interface.

**Registration order matters** – see `create-pipeline.ts`.

**Common patterns**:
- `init(ctx)` – store context, maybe subscribe to callbacks.
- `handle(pm, ctx)` – check `pm.type`, decide to render or pass.
- Call `ctx.provider.send()` or `ctx.provider.createThread()`.
- Return `"consumed"` if handled, else `"pass"`.

### Provider Directory

Currently only `discord.ts`. To add new provider:

1. Create `src/providers/<provider>.ts`
2. Implement required interfaces
3. Export factory or class
4. Modify daemon startup to select provider (config flag)

## Naming Conventions

| Element | Convention | Example |
|---------|------------|---------|
| Files | kebab-case | `jsonl-parser.ts`, `plan-mode.ts` |
| Directories | kebab-case | `src/handlers/`, `src/providers/` |
| Classes | PascalCase | `DiscordProvider`, `HandlerPipeline` |
| Interfaces | PascalCase | `ProcessedMessage`, `OutputProvider` |
| Functions | camelCase | `createPipeline()`, `parseJSONLString()` |
| Variables | camelCase | `sessionId`, `watcher`, `ctx` |
| Constants | UPPER_SNAKE_CASE | `BATCH_DELAY`, `MAX_MESSAGE_CACHE` |
| Types | PascalCase | `MessageHandler`, `ProviderMessage` |
| Discord IDs | PascalCase-dash | `Allow-Deny-<uuid>` |
| Enums | PascalCase | `Events`, `ButtonStyle` |

### File Extensions

- All source: `.ts`
- Compiled: `.js` (same name)
- Type declarations: `.d.ts`
- Config: `.json`
- Scripts: `.js` (hook scripts, statusline) – these are JS, not TS

## Module Boundaries & Public APIs

### Exported from `src/utils.ts`

- `CONFIG_DIR` – base config path
- `PIPE_REGISTRY` – pipe metadata dir
- `ID_PREFIX` – "claude-remote-"
- `STATUS_FLAG` – status flag file path
- `resolveJSONLPath(sessionId, projectDir?)` – transcript location
- `mimeToExt(mime)` – file extension from MIME
- `truncate(str, n)` – ellipsis truncation
- `capSet<T>(set, max)` – size-limited set
- `isLocalCommand(cmd)` – detect slash command
- `safeUnlink(path)` – delete ignoring ENOENT
- `extractToolResultText(result)` – get text from tool result
- `extractToolResultImages(result)` – get images from tool result
- `getToolInputPreview(input)` – preview for tool calls

**Rule**: Use these; don't reimplement.

### Exported from `src/provider.ts`

- `OutputProvider` interface
- `ThreadCapable` interface
- `InputCapable` interface
- `ProviderMessage`, `ProviderThread`, `OutgoingMessage`, `ProviderInteraction` types
- `hasThreads(p)`, `hasInput(p)` type guards
- `editOrSend(provider, handle, msg)` helper

### Exported from `src/pipeline.ts`

- `HandlerPipeline` class

### Exported from `src/create-pipeline.ts`

- `createPipeline(): HandlerPipeline` (main constructor)

### Exported from `src/jsonl-parser.ts`

- `parseJSONLString(jsonl: string): ProcessedMessage[]`
- `walkCurrentBranch(watcher, startSize, onLines): Promise<void>`
- `ProcessedMessage` type (re-exported from `types.ts`)

## Configuration Files

### User-Modified

- `~/.claude/claude-remote/config.json` – credentials
- `~/.claude/settings.json` – hooks & statusline (modified by install)
- `~/.claude/skills/remote/SKILL.md` – skill definition (installed)
- Shell profiles (`.bashrc`, PowerShell `$PROFILE`) – optional alias

### Generated (at runtime)

- `~/.claude/claude-remote/status` – enabled/disabled flag
- `~/.claude/claude-remote/pipe-registry/*.json` – pipe metadata
- `~/.claude/claude-remote/update-check.json` – version cache

### Build Output

- `dist/` – compiled JavaScript files (same basename, `.js` extension)
  - `cli.js`, `rc.js`, `daemon.js`, `remote-cmd.js`, etc.
  - Also `.d.ts` declaration files for TypeScript consumers
- `assets/` – static files copied as-is (preview.png)

## Constants & Magic Locations

Centralized in `src/utils.ts`:

```typescript
export const CONFIG_DIR = path.join(os.homedir(), ".claude", "claude-remote");
export const PIPE_REGISTRY = path.join(CONFIG_DIR, "pipe-registry");
export const ID_PREFIX = "claude-remote-";
export const STATUS_FLAG = path.join(CONFIG_DIR, "status");
```

Always use these instead of hardcoding paths.

## Build & Install Layout

### Global npm install

```
%APPDATA%\npm\node_modules\@hoangvu12\claude-remote\
├── package.json
├── README.md
├── dist/
│   ├── cli.js
│   ├── rc.js
│   ├── daemon.js
│   └── ...
└── node_modules/...
```

Symlinks `claude-remote` and `remote-cmd` in `%APPDATA%\npm\` point to `dist/cli.js` and `dist/remote-cmd.js`.

### Local dev (npm link)

- Symlink from global node_modules to local checkout
- `isLocalDev()` detects by checking if realpath includes "node_modules"

## Git Layout

```
.git/
├── HEAD -> refs/heads/master
├── config
├── description
├── hooks/
├── info/
├── logs/
├── objects/
├── refs/
└── index
```

`.gitignore` excludes:

- `dist/` (compiled output)
- `node_modules/`
- `*.log`
- OS temp files
- `.claude/` (user config – not repo)

## Conventions Summary

- **TypeScript strict** – no implicit `any`, null checks, etc.
- **ES Modules** – `import`/`export`, explicit `.js` extensions
- **Relative imports** – always relative to current file (`./utils`, `../provider`)
- **No barrel files** – import directly from module
- **Exports explicit** – no `export *` (except in some test scenarios)
- **Readme first** – README.md is primary user doc
- **Comments for complexity** – non-obvious logic documented inline
- **JSDoc sparse** – some public functions documented, but not enforced

## Unused/Debt Structural Items

- `src/discord-hook.js` – legacy, not used; kept for migration? (should be removed)
- `src/session-hook.js` – minimal, possible merge candidate with state-hook
- `src/activity.ts` – ActivityManager; ok, but could be merged into daemon?
- `src/statusline.js` – not in repo; generated at install time

## Testing Structure (non-existent)

No `__tests__/` or `test/` directories. If added:

```
__tests__/
├── unit/
│   ├── jsonl-parser.test.ts
│   ├── utils.test.ts
│   └── handlers/
├── integration/
│   └── daemon.test.ts (mock Discord)
└── fixtures/
    └── sample-transcript.jsonl
```

## Documentation Structure

- `README.md` – user-facing (setup, usage, what it looks like)
- `CONTRIBUTING.md` – dev guidelines (environment, build, style)
- `ARCHITECTURE.md` – high-level design (this suite)
- `STRUCTURE.md` – file layout (this file)
- `STACK.md` – tech stack details
- `INTEGRATIONS.md` – external API integrations
- `CONVENTIONS.md` – coding style & patterns
- `TESTING.md` – testing strategy (gap analysis)
- `CONCERNS.md` – known issues & tech debt

All Markdown (`.md`) except this STRUCTURE.md is in `.planning/codebase/`.

## Key Directories Outside src/

### `.github/workflows/`

- `publish.yml`: On release published → `npm publish`

### `assets/`

- `preview.png`: Screenshot for README

### `node_modules/`

- Standard npm dependencies

### `.claude/` (user home, not repo)

- `settings.json` – Claude Code settings (modified by install)
- `skills/remote/` – installed skill
- `claude-remote/` – config, status, pipe registry
- `transcripts/` – Claude JSONL transcripts (not managed by this tool)

## Module Resolution

- `tsconfig.json` sets `"moduleResolution": "Node16"`
- Imports must include file extension `.js` even for TypeScript files due to ES modules and `esModuleInterop`.
- Example: `import { HandlerPipeline } from "./pipeline.js"`

## Code Size Metrics

- **TypeScript files**: ~30
- **Total LOC** (approximate): 5000
- **Largest modules**:
  - `daemon.ts`: ~940 lines (core logic)
  - `cli.ts`: ~774 lines (setup wizard)
  - `jsonl-parser.ts`: ~400 lines (parsing)
  - `providers/discord.ts`: ~550 lines (Discord integration)
  - `handlers/tasks.ts`: ~300 lines (task boards)
  - `handlers/passive-tools.ts`: ~250 lines (grouping logic)
  - `handlers/tool-use.ts`: ~350 lines (tool call rendering)

## Refactoring Opportunities

1. **Split daemon.ts** – Too monolithic; extract watcher, pipeline management, state into separate classes/modules.
2. **Handler-specific utils** – `format-tool.ts` could be per-handler subfolder.
3. **Provider factory** – Decouple provider selection from daemon.
4. **Constants module** – Extract all magic numbers to `src/constants.ts`.
5. **Logger abstraction** – Replace `console.*` with structured logger.
6. **State class** – Encapsulate `daemon.ts` globals into `DaemonState`.

## File Naming Rationale

- `cli.ts` – "command-line interface"
- `rc.ts` – "remote control" (original discord-rc legacy)
- `daemon.ts` – background process (Linux term, though Windows)
- `remote-cmd.ts` – command-line controller for remote
- `jsonl-parser.ts` – parses the JSONL format
- `create-pipeline.ts` – factory function for pipeline
- `format-tool.ts` – tool name and input formatting
- `slash-commands.ts` – Discord slash command registration
- `utils.ts` – miscellaneous shared utilities

Handler names match purpose (`thinking.ts`, `tasks.ts`, etc.).
