# Contributing

Thanks for your interest in contributing to claude-remote!

## Development setup

```bash
git clone https://github.com/hoangvu12/claude-remote.git
cd claude-remote
npm install
```

### Running locally

Use `npm link` to test your local changes as a global CLI:

```bash
npm run build
npm link
```

Now `claude-remote` points to your local build. The auto-updater detects symlinked installs and skips itself during development.

To iterate quickly, rebuild after changes:

```bash
npm run build
```

The daemon supports **hot-reload** — it watches its own compiled JS and restarts automatically when `dist/daemon.js` changes, so you don't need to restart the full CLI for daemon-side changes.

### Type checking

```bash
npx tsc --noEmit
```

## Project structure

```
src/
  cli.ts                - CLI entry point (setup/uninstall/run, auto-update)
  rc.ts                 - PTY wrapper, named pipe server, daemon management
  daemon.ts             - JSONL watcher, message relay, progress forwarding
  provider.ts           - Abstract provider interfaces (Output, Input, Threads)
  providers/
    discord.ts          - Discord provider implementation
  handler.ts            - Handler interface and session context
  pipeline.ts           - Handler pipeline (ordered chain of message processors)
  create-pipeline.ts    - Wires up all handlers in order
  handlers/
    thinking.ts         - User prompt rendering
    plan-mode.ts        - Plan mode UI with action buttons
    tasks.ts            - Task tracking and pinned task board
    passive-tools.ts    - Groups Read/Grep/Glob into summaries
    tool-result.ts      - Routes tool results inline or to threads
    edit-write.ts       - File operation rendering with diffs
    tool-use.ts         - Tool invocations, permission prompts, progress
    tool-state.ts       - Shared tool tracking state
    default.ts          - Fallback renderer
  discord-renderer.ts   - Converts processed messages to Discord embeds
  format-tool.ts        - Tool-specific formatters (diff, bash, agent, etc.)
  jsonl-parser.ts       - Parses Claude's JSONL session files
  activity.ts           - Activity state tracking, queue, bot presence
  slash-commands.ts     - Discord slash command registration and handling
  discord-cmd.ts        - Standalone CLI for /discord skill
  discord-hook.ts       - UserPromptSubmit hook (legacy)
  session-hook.ts       - SessionStart hook (registers session with rc.ts)
  pipe-client.ts        - Named pipe client utilities
  statusline.ts         - Claude Code statusline script
  types.ts              - Shared TypeScript types
  utils.ts              - Shared constants and helpers
```

### Adding a new provider

The provider abstraction lives in `src/provider.ts`. A provider implements one or more interfaces:

- **`OutputProvider`** (required) — send, edit, delete, pin messages
- **`InputCapable`** — receive user messages and button/modal interactions
- **`ThreadCapable`** — create threads, send to threads, rename/archive

Look at `src/providers/discord.ts` for a full implementation. To add a new provider:

1. Create `src/providers/your-provider.ts` implementing `OutputProvider` (and optionally `InputCapable`, `ThreadCapable`)
2. Wire it up in `daemon.ts` where the Discord provider is currently instantiated
3. The handler pipeline is provider-agnostic — it uses the abstract interfaces

### Adding a new handler

Handlers process messages in the pipeline. To add one:

1. Create `src/handlers/your-handler.ts` implementing the `Handler` interface
2. Add it to the pipeline in `src/create-pipeline.ts` (order matters — earlier handlers get first pick)

A handler's `process()` method returns `true` if it claimed the message, `false` to pass it to the next handler.

## Releasing a new version

Releases are published to npm via GitHub Actions when a version tag is pushed.

### Quick release

```bash
# Bump version (patch, minor, or major)
npm version patch    # 1.1.0 → 1.1.1
npm version minor    # 1.1.0 → 1.2.0
npm version major    # 1.1.0 → 2.0.0

# Push commit + tag
git push && git push --tags
```

`npm version` automatically:
1. Updates `version` in `package.json`
2. Creates a git commit
3. Creates a git tag (`v1.1.1`)

Pushing the tag triggers the GitHub Actions workflow which builds and publishes to npm.

### Manual publish (fallback)

If CI isn't set up yet or you need to publish manually:

```bash
npm run build
npm publish
```

## Pull requests

1. Fork the repo and create a branch from `master`
2. Make your changes
3. Run `npx tsc --noEmit` to verify types
4. Open a PR against `master`

Keep PRs focused — one feature or fix per PR.
