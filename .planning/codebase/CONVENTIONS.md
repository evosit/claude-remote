# Code Conventions

## Core Principles

1. **TypeScript strict mode** – no implicit `any`, null checks, exhaustive switches.
2. **Node16 ESM** – explicit `.js` extensions in imports, `"type": "module"` in package.json.
3. **Graceful degradation** – External failures (Discord API) should not crash; log and continue.
4. **Provider abstraction** – Core logic depends on interfaces, not concrete Discord classes.
5. **Handler pipeline** – Single-responsibility handlers, order matters, use `consumed` to short-circuit.
6. **Logging with prefix** – `[daemon]`, `[rc]`, `[activity]`, `[discord]` for source identification.
7. **Constants centralized** – All magic numbers go in `src/utils.ts` or a future `constants.ts`.

## TypeScript Configuration

- **Target**: `ES2022` – modern Node 18+ features
- **Module**: `Node16` – Node-style ESM resolution
- **Strict**: `true` – all strict flags enabled
- **esModuleInterop**: `true` – CommonJS compatibility shim
- **declaration**: `true` – generate `.d.ts` for consumers
- **sourceMap**: `true` – debug in DevTools
- **skipLibCheck**: `true` – faster builds (trust external types)
- **forceConsistentCasingInFileNames**: `true` – case-sensitive file systems safe

## Code Formatting

No enforced formatter (Prettier not configured). Community conventions:

- **Indentation**: 2 spaces (as seen in existing code)
- **Semicolons**: Optional (most files omit)
  - If editing existing file, match its style.
  - New files: omit semicolons (consistent with repo trend).
- **Quotes**: Single quotes preferred (`'`) in newer code; double in older (mixed). Don't change existing.
- **Trailing commas**: Yes, for multi-line object/array literals.
- **Max line length**: ~100 (soft), break when it improves readability.
- **Blank lines**: Separate logical blocks; between functions; after imports.

**Exception**: Generated files (hook scripts, statusline) are plain JS, not formatted.

## Naming Conventions

| Element | Convention | Example |
|---------|------------|---------|
| Files (source) | kebab-case | `jsonl-parser.ts`, `create-pipeline.ts` |
| Directories | kebab-case | `src/handlers/`, `src/providers/` |
| Classes | PascalCase | `DiscordProvider`, `HandlerPipeline` |
| Interfaces | PascalCase | `ProcessedMessage`, `OutputProvider` |
| Functions | camelCase | `createPipeline()`, `parseJSONLString()` |
| Variables | camelCase | `sessionId`, `watcher`, `pendingBatch` |
| Constants (module-level) | UPPER_SNAKE_CASE | `BATCH_DELAY`, `MAX_MESSAGE_CACHE` |
| Type aliases | PascalCase | `MessageHandler = (pm, ctx) => ...` |
| Enum members | PascalCase | `Events.MessageCreate`, `ButtonStyle.Primary` |
| Discord custom IDs | PascalCase with dashes | `Allow-Deny-<uuid>`, `Select-Mode-<uuid>` |
| Event handlers | `on<Event>` | `onUserMessage`, `onInteraction` |
| File paths | kebab-case | `./utils.js`, `../providers/discord.js` |

## Import Style

### Relative imports with explicit extension

```typescript
import { HandlerPipeline } from "./pipeline.js";
import type { ProcessedMessage } from "./types.js";
import { DiscordProvider } from "./providers/discord.js";
```

**Never** omit `.js` extension (Node16 ESM).

### Standard library imports

Use `node:` prefix:

```typescript
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { execSync } from "node:child_process";
```

### External packages

```typescript
import { Client, Events } from "discord.js";
import chokidar from "chokidar";
import p from "@clack/prompts";
```

No `import * as` unless necessary (e.g., `import * as fs from "node:fs"` for namespace types). Prefer named imports.

### Type-only imports

Use `import type` for types-only to reduce runtime dependencies:

```typescript
import type { ProcessedMessage } from "./types.js";
import type { TextChannel } from "discord.js";
```

## Error Handling

### Philosophy

- **Fail gracefully** – Discord API errors should not crash daemon.
- **Best effort** – Cleanup operations should not throw.
- **Silent expected failures** – Edit/delete on already-deleted messages is okay to ignore.
- **Log context** – Include relevant data (message IDs, channel names) when logging.
- **Top-level safety** – Add `process.on("unhandledRejection")` in entry points? (Not currently done.)

### Patterns

**Try-catch with ignore for expected failures**:

```typescript
try {
  await message.edit(payload);
} catch {
  // message may have been deleted by user, ignore
}
```

**Return null on failure, caller continues**:

```typescript
const sent = await this.rateLimitedSend(this.channel, payload);
if (!sent) return null; // provider returns null on failure
```

**Log errors for unexpected failures**:

```typescript
console.error("[daemon] Failed to create channel:", err);
```

**Fire-and-forget with swallow**:

```typescript
try {
  await someNonCriticalAsync();
} catch {
  // best effort, ignore
}
```

### When to Crash

Currently, no global error handler. Unexpected errors (programmer mistakes) should crash to surface bugs:

- `JSON.parse` on malformed JSONL → throw (should not happen)
- Undefined properties → TypeError (should not happen)
- Assertion failures → throw

Do **not** catch and ignore programmer errors. Let them crash during development.

## Async Patterns

- **Prefer `async/await`** over `.then()` chains for readability.
- **Parallelism**: Use `Promise.all()` for independent async operations.
- **Sequential**: When order matters, use `await` in series.
- **Fire-and-forget**: For background tasks (update check, logging) that don't affect outcome.

Example:

```typescript
const [guilds, channels] = await Promise.all([
  fetchGuilds(token),
  fetchChannels(token),
]);

if (guilds.length === 0) throw new Error("No guilds");
```

## State Management

### Module-level `let` variables

Accepted in single-threaded Node processes for simplicity:

```typescript
let sessionId = "";
let watcher: FSWatcher | null = null;
let processedUuids = new Set<string>();
```

**Drawback**: Hard to test (module cache persists between tests). Future refactor: encapsulate in `Daemon` class.

### SessionContext

Shared mutable context passed to handlers:

```typescript
interface SessionContext {
  provider: DiscordProvider;
  channel: TextChannel;
  isEnabled: boolean;
  isBusy: boolean;
  taskBoardHandle: ProviderMessage | null;
  passiveGroup: PassiveGroup | null;
  activeThreads: Map<string, ProviderThread>;
  onInteraction?: (interaction) => Promise<boolean>;
}
```

Handlers may mutate fields (e.g., `taskBoardHandle = result`). Document side effects.

### Constants & Magic Numbers

**Never** hardcode without explanation. Move to `src/utils.ts` or `src/constants.ts`:

```typescript
// BAD
const delay = 600; // what is 600?

// GOOD
const BATCH_DELAY = 600; // ms debounce to reduce API bursts
```

Add JSDoc if non-obvious:

```typescript
/** Time (ms) to wait for new lines before flushing batch. */
const BATCH_DELAY = 600;
```

## Logging Conventions

### Console methods

- `console.log()` – Normal informational messages (startup, channel created)
- `console.error()` – Errors that don't crash (API failures, missing env)
- `console.warn()` – Rare, for deprecations or non-critical issues
- `console.debug()` – Not used (no log level checks)
- `console.table()` – Not used

### Prefixes

Always prefix with `[source]` to identify subsystem:

```typescript
console.log("[daemon] Session: ${sessionId}");
console.error("[daemon] Missing DISCORD_BOT_TOKEN");
console.log("[activity] Idle timeout – no activity for 2m");
console.error("[discord] Failed to send message:", err);
```

In `cli.ts` (setup wizard), use `@clack/prompts` instead of raw console logs:

```typescript
p.log.step("Validating bot token");
p.log.info("Server: MyServer");
p.log.error("Invalid token");
```

### Log content

- Include relevant identifiers: channel ID, message ID, user ID.
- Avoid logging tokens or sensitive data.
- Errors: log stack trace? Not done currently – but could add `console.error(err)`.

## Security Practices

### Token handling

- Bot token stored in `config.json` (0600 not enforced; local user already has access).
- Passed to daemon via environment variable `DISCORD_BOT_TOKEN` (not visible to other accounts on Windows? Process env visible to admins.)
- Never log the token (mask if needed in errors).

### Exec safety

`execSync` used for:
- PowerShell profile detection: `execSync('powershell -NoProfile -Command "echo $PROFILE"')`
- Self-update: `execSync('npm install -g ...')`

These commands have no user input, so safe. However, prefer `execFile` or `spawnSync` to avoid shell:

```typescript
spawnSync("npm", ["install", "-g", `${PKG_NAME}@${latest}`], { stdio: "pipe" });
```

### File paths

Paths from Claude trusted (Claude generates them). Paths from user input (Discord) validated by Discord.js (no path traversal from Discord).

## Cross-Platform Handling

### Windows-first

- `CLAUDE_BIN = "claude.exe"` hardcoded in `rc.ts`.
- ConPTY terminal restoration escape: `process.stdout.write("\x1b[?9001l")`.
- Named pipes: `\\.\pipe\claude-remote-<pid>`.
- Shell detection: PowerShell 5, PowerShell 7 (`pwsh`), Git Bash, CMD shim.

### Unix (not supported)

Could be supported with:
- `claude` binary (no `.exe`)
- `node-pty` works on Unix (different PTY implementation)
- No ConPTY hack needed
- Named pipes become Unix domain sockets? (`/tmp/...`) – but `net.createServer` on pipe path may differ.

**Current**: Platform-specific code not isolated behind abstraction. Windows assumptions baked in.

## Testing Philosophy

**No automated tests** – manual integration testing only.

**Why**:
- Discord integration requires live bot; test infra heavy.
- PTY processes hard to mock.
- Handlers complex but testable in isolation (just not done yet).

**Desired future**:
- Unit tests for `jsonl-parser`, `utils`, individual handler `handle()` functions.
- Mock `SessionContext` and `DiscordProvider`.
- Use `jest` or `vitest`.

**Integration test checklist** (see `TESTING.md`).

## Git Workflow

- **Branch**: Main branch is `master` (no feature branches in repo).
- **Commits**: Atomic, descriptive messages. Reference issues if any.
- **Release**: GitHub Release → CI publishes to npm.
- **Versioning**: SemVer (`major.minor.patch`), bumps in `package.json`.

## Dependency Management

- **Pinning**: `^` range for minor updates (auto-accepts patch, tests before merge for minor).
- **No lockfile**: `package-lock.json` not committed (global install tool).
- **Update manually**: `npm install <pkg>@latest` then test.

## Documentation Standards

- **README.md** – Primary user doc. Keep updated for setup, usage, features.
- **Inline comments** – For non-obvious logic (e.g., why 150ms delay for key simulation, why 2-minute idle timeout).
- **JSDoc** – For public functions and exported types (sparse, improve gradually).
- **Architecture docs** – `.planning/codebase/*.md` for maintainers.

## Deprecation Policy

- **Old skill**: `/discord` → removed automatically during `setup()` (detects and deletes old skill dir).
- **Legacy hooks**: `discord-hook.js` remains but not registered. Should be removed in major version.
- **API changes**: Breaking changes to exported APIs (provider, handlers) should be documented and version-bumped.

## Code Review Checklist

When reviewing PRs:

- ✅ TypeScript compiles (`npm run build`)
- ✅ No new `any` types (unless absolutely necessary, with comment)
- ✅ Error handling follows patterns (graceful degradation for external APIs)
- ✅ Logging has source prefix
- ✅ Constants extracted (no new magic numbers)
- ✅ Handler order doesn't break priority (if new handler)
- ✅ Provider interface still satisfied (if modifying provider)
- ✅ No new Windows assumptions if adding cross-platform intent (document)
- ✅ Tests added for pure functions (if expanding test coverage)
- ✅ README updated for user-facing changes

## Performance Considerations

- **Batching**: 600ms debounce in daemon. Don't arbitrarily change without measuring burst impact.
- **Rate limiting**: 5/5s in DiscordProvider. Keep hard limit, possibly add queue.
- **Caching**: LRU caches (80 messages, 40 threads). Don't grow unbounded.
- **Set growth**: `processedUuids` and `knownUuids` grow without bound – acceptable for sessions <24h. Consider pruning if long sessions (>1 week) become common.
- **Memory**: Avoid keeping large buffers; use streaming where possible.

## Refactoring Guidelines

1. **Add tests before refactoring** – especially for `jsonl-parser`, handlers.
2. **Keep behavior identical** – Integration tests (manual) must still pass.
3. **Extract constants first** – before changing algorithm, make parameters configurable.
4. **Encapsulate state** – move module `let` variables into classes when testing pain point high.
5. **Preserve provider interface** – new providers should not require core changes.

## Style Violations

Allowed in:
- Generated files (`statusline.js`, hook scripts) – plain JS, no TS.
- Third-party code (node_modules) – ignore.
- Legacy code with different style – match surrounding code when editing.

## Tools Not Used (but could)

- **ESLint** – would catch unused vars, implicit any, etc. Consider adding.
- **Prettier** – auto-format; would standardize quotes/semicolons. Could adopt.
- **Husky** – pre-commit hooks to run build/lint.
- **typedoc** – API documentation generator.

**Why not?**: Small project, low churn, manual process acceptable.

## Signature Patterns

### Handler

```typescript
export class MyHandler implements MessageHandler {
  types = ["assistant"]; // optional filter

  init(ctx: SessionContext): void {
    // one-time setup
  }

  async handle(pm: ProcessedMessage, ctx: SessionContext): Promise<"consumed" | "pass"> {
    // logic
    if (shouldConsume) {
      // do something (send, create thread, etc.)
      return "consumed";
    }
    return "pass";
  }

  destroy(): void {
    // cleanup
  }
}
```

### Provider method

```typescript
async send(msg: OutgoingMessage): Promise<ProviderMessage | null> {
  // Build platform-specific payload
  // Apply rate limiting if needed
  // Call API
  // Cache result
  // Return handle
}
```

### IPC handler

```typescript
process.on("message", (msg: ParentToDaemon) => {
  if (msg.type === "session-register") {
    // handle
  } else if (msg.type === "enable") {
    // handle
  }
  // ...
});
```

## Conventions Summary Table

| Area | Convention |
|------|------------|
| Imports | Relative, explicit `.js`, `import type` for types |
| Files | kebab-case `.ts`, 2-space indent, no semicolons (mostly) |
| Classes | PascalCase, single responsibility |
| Functions | camelCase, small, pure where possible |
| Constants | UPPER_SNAKE_CASE, centralized |
| Errors | Graceful degrade for external failures, crash for programmer errors |
| Logging | `[source]` prefix, `log` or `error` as appropriate |
| State | Module `let` for simple, `SessionContext` for shared |
| Async | `async/await`, `Promise.all` for parallel |
| Types | Strict, no `any`, exhaustive `switch` |
| Documentation | Inline for complex logic, JSDoc for public APIs |
| Testing | Manual integration (gap: unit tests desired) |

## Anti-Patterns to Avoid

- ❌ Mixing provider-specific types in core code (leaks abstraction)
- ❌ Catching and ignoring all errors (loses visibility)
- ❌ Hardcoding paths or magic numbers
- ❌ Long functions (>100 lines) – extract
- ❌ Global mutable state across modules (except within single module's scope)
- ❌ Using `exec` with user input (use `execFile`/`spawn`)
- ❌ Blocking the event loop (long-running sync ops)
- ❌ Assumptions about file existence without try/catch

---

**Maintained as part of**: `.planning/codebase/CONVENTIONS.md`
