# Technology Stack

## Languages & Runtime

- **Primary Language**: TypeScript (strict mode)
- **Target**: ES2022
- **Runtime**: Node.js 18+
- **Module System**: Node16 (ES Modules)
- **Package Manager**: npm

## Build & Compilation

- **Compiler**: TypeScript (`tsc`)
- **Output Directory**: `dist/`
- **Source Directory**: `src/`
- **Configuration**: `tsconfig.json`
  - `strict: true`
  - `esModuleInterop: true`
  - `declaration: true`
  - `sourceMap: true`

## Dependencies

### Production Dependencies

- `@clack/prompts` (^1.1.0) - Interactive CLI prompts with spinners and task lists
- `chokidar` (^4.0.3) - File watching for JSONL transcript monitoring
- `discord.js` (^14.18.0) - Discord bot API client
- `node-pty` (^1.0.0) - Pseudo-terminal for spawning Claude processes
- `picocolors` (^1.1.1) - Terminal string coloring

### Development Dependencies

- `typescript` (^5.8.2) - TypeScript compiler
- `@types/node` (^22.13.10) - Node.js type definitions

## Project Structure

```
claude-remote/
├── src/              # TypeScript source files (~5000 LOC)
│   ├── cli.ts        # Main CLI entry point, setup, uninstall
│   ├── rc.ts         # Parent process, spawns PTY + daemon
│   ├── daemon.ts     # Discord bot, JSONL watcher
│   ├── remote-cmd.ts # Control channel commands
│   ├── provider.ts   # Provider abstraction interfaces
│   ├── providers/
│   │   └── discord.ts # Discord-specific implementation
│   ├── handlers/     # Message type handlers
│   ├── jsonl-parser.ts # Claude JSONL format parsing
│   └── ...           # Utilities, types, etc.
├── dist/             # Compiled JavaScript output
├── package.json      # Dependencies and scripts
└── tsconfig.json     # TypeScript configuration
```

## Configuration

### Environment Variables (Runtime)

- `DISCORD_BOT_TOKEN` - Discord bot token
- `DISCORD_GUILD_ID` - Discord server ID
- `DISCORD_CATEGORY_ID` - Category for session channels

### User Configuration

- Stored in `~/.claude/claude-remote/config.json`
- Contains: `discordBotToken`, `guildId`, `categoryId`

### Claude Code Integration

- Installs `/remote` skill to `~/.claude/skills/remote/`
- Modifies `~/.claude/settings.json`:
  - `statusLine` - Shows remote status in terminal
  - `hooks` - SessionStart, Stop, PostCompact event hooks

## Binaries

- `claude-remote` - Main CLI wrapper
- `remote-cmd` - Control running sessions from command line

## Key Technologies

- **Discord Integration**: Full bot with slash commands, buttons, select menus, threads, modals
- **PTY Handling**: Spawns `claude.exe` in pseudo-terminal for cross-platform compatibility
- **Named Pipes**: IPC between parent (rc.ts) and daemon processes
- **JSONL Streaming**: Tail-based watching of Claude's transcript file
- **Handler Pipeline**: Modular processing of different message types

## OS Support

- **Windows**: Primary target (Claude Code desktop app)
- **macOS/Linux**: Not officially supported yet (README notes)

## Code Quality

- **Type Safety**: Full TypeScript strict mode
- **Error Handling**: Try-catch blocks throughout, graceful degradation
- **Logging**: Convention-based console logging with `[daemon]`, `[activity]` prefixes
- **Rate Limiting**: 5 messages per 5-second window (Discord API protection)
