# Concerns: Technical Debt, Bugs, Risks

## Critical Issues (Fix Soon)

### 1. ❌ Zero Automated Tests

**Severity**: Critical
**Impact**: Every change risks regression; no safety net for refactoring.
**Location**: Entire codebase.
**Evidence**: No `__tests__/`, no test scripts in `package.json`.
**Recommendation**: Start with `jsonl-parser.test.ts` (pure functions, high value). Add Jest/Vitest. Target 70% coverage.

---

### 2. ❌ Windows-Only Platform

**Severity**: Critical (for non-Windows users)
**Impact**: 50%+ of developers cannot use this tool.
**Location**: `src/rc.ts:15` – `const CLAUDE_BIN = "claude.exe";`
**Evidence**: README states "Windows (macOS/Linux not supported yet)".
**Root cause**: Claude Code desktop is Windows-only (currently). Could be revisited if Claude ships on other platforms.
**Workaround**: Document clearly; maybe detect `claude` vs `claude.exe` when platform expands.

---

### 3. ⚠️ execSync Injection Pattern

**Severity**: Medium (low probability, high impact if exploited)
**Location**: `src/cli.ts:696`
```typescript
execSync(`npm install -g ${PKG_NAME}@${latest}`, { stdio: ["pipe", "pipe", "pipe"], timeout: 60000 });
```
**Risk**: If npm registry response is compromised (MITM or malicious package), arbitrary command execution.
**Mitigation**: npm itself verifies package signatures; registry is HTTPS. Still, pattern discouraged.
**Fix**: Use `spawnSync` with args array:
```typescript
spawnSync("npm", ["install", "-g", `${PKG_NAME}@${latest}`], { stdio: "pipe", timeout: 60000 });
```
**Also**: `cli.ts:222`, `:235`, `:303` use `execSync` but with hardcoded commands (safer). Consider switching to `execFile` for consistency.

---

### 4. 🔴 Race Condition: Daemon Restart

**Severity**: Medium
**Impact**: Orphaned daemon processes if `session-register` fires rapidly.
**Location**: `src/daemon.ts:94-97`
```typescript
if (daemonWasEnabled && oldSessionId && oldSessionId !== sessionId) {
  stopDaemon();
  startDaemon();
}
```
**Scenario**: User rapidly toggles `/remote on`/`off`, or multiple `rc` processes compete. Could start multiple daemons.
**Fix**: Add `daemonStarting` flag; queue or debounce restarts. Ensure `stopDaemon()` completes before `startDaemon()`.

---

### 5. 🔴 Unbounded Memory Growth: UUID Sets

**Severity**: Medium (low immediate risk)
**Location**: `src/daemon.ts:30-32`
```typescript
let processedUuids = new Set<string>();
let knownUuids = new Set<string>();
```
**Risk**: Long-running sessions (weeks) accumulate UUIDs forever (~40 bytes each). 1M UUIDs = 40 MB. Not catastrophic but unbounded.
**Fix**: Implement LRU or TTL; prune old entries (e.g., older than 24h). Or cap at N (e.g., 100k) with warnings.

---

### 6. 🔴 Terminal Restoration Hack (Windows)

**Severity**: Medium (may break with OS updates)
**Location**: `src/rc.ts:33-35`
```typescript
if (process.platform === "win32") {
  process.stdout.write("\x1b[?9001l");
}
```
**Issue**: Undocumented escape sequence to work around Windows Terminal ConPTY bug (see `cli.ts:17-20` comment referencing GitHub issues). Hacks are fragile.
**Risk**: Future Windows Terminal versions may change behavior, break terminal state after exit.
**Mitigation**: Track upstream bug; remove hack when fixed in Windows Terminal. Add version check if possible.

---

## Moderate Concerns

### 7. 🟡 Inconsistent Error Handling

**Severity**: Medium
**Location**: Various
**Issue**: Some functions use `try/catch` everywhere and log; others let errors propagate. No unified strategy.
**Examples**:
- `DiscordProvider` methods: Silently ignore edit/delete failures (appropriate).
- `pipe-client.ts:sendPipeMessage()` – rejects on error (could be handled).
- Top-level: No `unhandledRejection`/`uncaughtException` handlers (process will crash on unexpected).
**Impact**: Hard to reason about what failures are fatal vs recoverable.
**Recommendation**: Document error handling policy. Consider top-level catch that logs and exits with non-zero code for unexpected. Use `try/catch` only for expected failure modes (network, missing resources).

---

### 8. 🟡 No Backpressure on Message Bursts

**Severity**: Medium
**Location**: `src/daemon.ts:42` – `BATCH_DELAY = 600`
**Issue**: Claude can output many messages quickly (<600ms). All get batched and flushed together; rate limiter in provider then discards or throttles.
**Impact**: Hitting Discord 5/5s limit may cause 429 errors, dropped messages.
**Current defense**: Rate limiter rejects excess by throttling, but batches could be >5 messages.
**Better**: Split large batches into smaller chunks respecting rate window. Or implement token bucket.
**Recommendation**: Before flush, check how many messages are pending; if >RATE_LIMIT, delay flush until tokens available.

---

### 9. 🟡 Magic Numbers Everywhere

**Severity**: Low (code readability)
**Location**: Scattered
**Examples**:
- `BATCH_DELAY = 600`
- `KEY_DELAY = 150`
- `MAX_SET_SIZE = 3000`
- `RATE_WINDOW = 5000`, `RATE_LIMIT = 5`
- `MAX_MESSAGE_CACHE = 80`, `MAX_THREAD_CACHE = 40`
- `ACTIVITY_TIMEOUT = 120_000` (2m)
**Issue**: No rationale; hard to tune for different use cases.
**Fix**: Move to `src/constants.ts` with JSDoc explaining origin and trade-offs.

---

### 10. 🟡 Global Mutable State

**Severity**: Low-Medium (testability)
**Location**: Module-level `let` in `daemon.ts`, `rc.ts`
**Issue**: Makes unit testing hard because module cache persists between tests; hidden coupling.
**Example**: `let sessionId = ""; let watcher: FSWatcher | null = null;` etc.
**Fix**: Encapsulate in classes:
```typescript
class Daemon {
  private sessionId: string;
  private watcher: FSWatcher | null;
  // ...
}
```
Then tests can instantiate fresh `Daemon()` per test.
**Cost**: Refactor effort; not urgent but desirable.

---

### 11. 🟡 Dead Code & Artifacts

**Severity**: Low
**Location**: Various
**Items**:
- `src/discord-hook.js` – Not used in current architecture (legacy from discord-rc).
- `src/session-hook.js` – Could be merged with `state-hook.js`.
- `PIPE_REGISTRY` directory logic – only used by old hook? Possibly unused now.
- `ID_PREFIX` may have leftover uses.
**Impact**: Confusion for future maintainers; extra files to track.
**Fix**: Remove truly dead code. If kept for compatibility, mark `DEPRECATED` with comment and plan removal.

---

### 12. 🟡 Stale Pipe Registry Cleanup Race

**Severity**: Low (self-correcting)
**Location**: `src/pipe-client.ts:23-30`
```typescript
try {
  process.kill(entry.pid, 0);
  return entry.pipe;
} catch {
  // Process dead, clean up stale entry
  try { fs.unlinkSync(path.join(PIPE_REGISTRY, file)); } catch { /* race */ }
}
```
**Race**: After checking PID alive, process could die before caller uses pipe. Connection then fails, caller retries (3s timeout).
**Impact**: Minor noise; not a correctness issue.
**Fix**: Accept race as inevitable; maybe log connection errors at debug level only.

---

### 13. 🟡 Slash Commands One-Shot Registration

**Severity**: Low-Medium
**Location**: `daemon.ts` startup calls `setupSlashCommands()` once.
**Issue**: If Discord API call fails (network down), slash commands won't be registered and won't retry.
**Impact**: Users lack `/mode`, `/clear`, etc. until daemon restart.
**Fix**: Retry with exponential backoff. Or on first slash command usage, check registration and attempt if missing.

---

### 14. 🟡 Long JSONL Replay Slow Startup

**Severity**: Low (performance)
**Location**: `daemon.ts:walkCurrentBranch()` reads entire file to find new lines.
**Issue**: Multi-megabyte transcripts (multi-day sessions) could take seconds to read.
**Impact**: Perceived slowness when resuming large sessions.
**Fix**: Store byte offset position; seek to offset on restart. Cap replay to last N lines (e.g., 1000) if very large.

---

## Low-Priority / Future

### 15. 🔵 No Authentication on IPC Pipe

**Severity**: Low (local threat model)
**Issue**: Named pipe `\\.\pipe\claude-remote-<pid>` accessible by any local process.
**Risk**: Malicious local process could send `enable`/`disable` commands, or impersonate Discord interactions.
**Acceptable**: Local user already has full control; no privilege escalation.
**Enhancement**: Windows ACL to restrict to same user; or validate sender PID (if possible).

---

### 16. 🔵 Discord API Version Lock

**Severity**: Low-Medium (maintenance)
**Issue**: `discord.js` pinned to ^14.18.0 (minor updates only). Discord API changes may break; v15 in development.
**No automation**: No Dependabot/Renovate to open PRs on new versions.
**Mitigation**: Periodic manual updates; test in a branch before merging.
**Recommendation**: Enable Dependabot on GitHub.

---

### 17. 🔵 Excessive Console.log in Production

**Count**: ~30 `console.log`/`console.error` across codebase.
**Issue**: In high-volume sessions, logs may be noisy. No log levels.
**Not a problem** for CLI tool; user can redirect output.
**Future**: Structured logger (pino, winston) if log analysis needed.
**For now**: Acceptable.

---

### 18. 🔵 Missing Config Validation

**Severity**: Low
**Location**: `src/cli.ts:loadConfig()`
```typescript
try { return JSON.parse(fs.readFileSync(CONFIG_FILE, "utf-8")) as Config; } catch { return null; }
```
**Issue**: No schema validation. If user manually edits `config.json` and typos field (`discordBotToken` → `discordBottoken`), runtime errors occur (missing env var).
**Fix**: Simple check:
```typescript
if (!config.discordBotToken || !config.guildId || !config.categoryId) {
  throw new Error("Invalid config: missing fields");
}
```

---

### 19. 🔵 No Retry Logic for Discord API Calls

**Severity**: Low (network resilience)
**Issue**: Transient network failures (rate limit 429, 5xx) cause immediate failure.
**Current**: Rate limiter throttles, but doesn't retry on 429 after backoff. Other failures (500, 502, 503) not retried.
**Impact**: Intermittent connectivity issues drop messages.
**Fix**: Wrap Discord API calls in retry with exponential backoff (max 3 attempts). Respect `Retry-After` header on 429.

---

### 20. 🔵 Key Sequence Timing Magic

**Severity**: Low (fragile)
**Location**: `src/daemon.ts:59-66`
```typescript
const KEY_DELAY = 150;
function sendKeySequence(keys: string[]) {
  keys.forEach((key, i) => {
    setTimeout(() => sendToParent({ type: "pty-write", text: key, raw: true }), i * KEY_DELAY);
  });
}
```
**Issue**: Timing tuned for Claude's Ink menus (150ms per key). Could break if Claude changes timing or if system under load.
**Risk**: Approvals fail (buttons not clicked).
**Mitigation**: Make delay configurable, or detect "prompt failed" and retry with longer delay.

---

### 21. 🔵 No Metrics or Observability

**Severity**: Low (ops)
**Issue**: No Prometheus metrics, no structured logs, no tracing.
**Impact**: Hard to diagnose performance issues, rate limits, errors in production.
**Non-critical**: Manual tool; users report issues directly.
**Future**: Simple counters (messages sent, rate limit hits, errors) via console or file.

---

### 22. 🔵 Activity Timeout Arbitrary

**Severity**: Low (UX)
**Location**: `src/activity.ts` – `IDLE_TIMEOUT = 2 * 60 * 1000` (2 minutes)
**Issue**: Why 2 minutes? Could be too aggressive or too lenient.
**Impact**: Statusline may show "○" while Claude is still working (if >2m between outputs), or show "●" briefly when idle.
**Fix**: Make configurable in settings, or tune based on user feedback.

---

## Risk Register

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Windows Terminal breaks PTY restore | Medium | High | Track upstream, update escape sequence |
| Discord.js v15 breaks | Medium | High | Pin minor, test before upgrade, enable Dependabot |
| execSync compromise (self-update) | Low | Critical | Use `spawnSync`, verify npm signatures |
| Daemon leak on rapid toggle | Medium | Medium | Debounce restart, add flag |
| UUID set OOM | Low | Medium | Periodic prune, or capped LRU |
| Slash commands not registered | Low | Medium | Retry on first interaction |
| Burst messages exceed rate limit | Low | Medium | Backpressure, batch splitting |
| Configuration corruption | Low | Low | Schema validation at load |
| IPC pipe auth bypass | Low | Low | Acceptable given local threat model |

---

## Observed Bugs (from Code Review)

### A. PTY Terminal State Not Restored on Crash

**Location**: `rc.ts:restoreTerminal()` only called on `proc.onExit`.
**Issue**: If parent crashes (SIGKILL), terminal may remain in raw mode.
**Impact**: User's terminal messed up until they close it.
**Workaround**: User can run `reset` command.
**Fix**: Not easily fixable (can't catch SIGKILL). Document in README.

### B. Channel Reuse Logic May Collide

**Location**: `daemon.ts:findExistingChannel()` looks for `categoryId` + name prefix.
**Issue**: If user manually creates channel with same name in different category, may reuse wrong channel.
**Impact**: Messages go to wrong channel.
**Mitigation**: Check category ID strictly (code already does). Name collision only within category.

### C. Hook Installation Not Fully Idempotent

**Location**: `cli.ts:cleanRemoteHooks()` filters only by `command` property, not by `matcher`.
**Issue**: If user adds custom matcher, our hook might be missed and duplicated.
**Impact**: Multiple identical hooks could accumulate.
**Fix**: Check both `matcher` and `command`, or use unique marker in matcher string.

---

## Refactoring Candidates (Priority Order)

1. **Extract Constants** – Move all magic numbers to `src/constants.ts` with JSDoc. Low risk, improves readability.
2. **Encapsulate Daemon State** – Create `Daemon` class with methods, replace module vars. Improves testability.
3. **Add Retry Wrapper** – Decorator for Discord API calls; retries on 429/5xx.
4. **Implement Rate Limiter Class** – Replace array-based sliding window with token bucket for clarity.
5. **Provider Factory** – Decouple daemon from specific DiscordProvider instantiation.
6. **Logger Abstraction** – Replace `console.*` with `Logger` interface (levels, JSON output option).
7. **Split Daemon Module** – Break `daemon.ts` into smaller files: `daemon-state.ts`, `watcher.ts`, `slash-commands.ts`, `channel-manager.ts`.
8. **IPC Protocol Library** – Strongly typed IPC messages instead of ad-hoc JSON.

---

## Technical Debt Metrics

| Metric | Current | Target |
|--------|---------|--------|
| Test coverage | ~0% | 70% overall, 80% critical |
| ESLint configured | ❌ | ✅ |
| Prettier configured | ❌ | ✅ |
| Dependabot enabled | ❌ | ✅ |
| TypeScript strict | ✅ | ✅ |
| Dead code removed | Partial | ✅ |
| Magic numbers extracted | ❌ | ✅ |
| Global state encapsulated | ~10% | 80% |
| Cross-platform support | 0% (Windows-only) | Future |

---

## Maintenance Burden

- **High**: Discord API changes, Discord.js version upgrades.
- **Medium**: Claude Code JSONL format changes (internal, undocumented).
- **Low**: Node.js version upgrades (LTS).
- **Negligible**: OS-level PTY changes (node-pty handles).

---

## Security Posture

| Concern | Status | Notes |
|---------|--------|-------|
| Token storage | ⚠️ Plaintext | Acceptable for local tool; consider OS keyring |
| IPC auth | ❌ None | Local threat model OK |
| exec usage | ⚠️ execSync | Use `spawnSync` for safety |
| Input sanitization | ✅ Discord.js handles | No SQL/command injection |
| Rate limiting | ✅ Basic 5/5s | Could be smarter |
| Logging sensitive data | ✅ No token logs | Ensure remains so |

---

## Known Compatibility Issues

- **Windows Terminal**: Escape sequence hack; may break in future versions. (Tracking: https://github.com/microsoft/terminal/issues)
- **Claude Code**: Assumes JSONL format stable. No contract; could break on updates.
- **Node.js**: Requires 18+ (discord.js requirement). Not tested onNode 20+ specifically (should work).
- **node-pty v1**: May have Windows-specific quirks; v2.0 upcoming could break.

---

## Upgrade Path Concerns

When upgrading dependencies:

1. **discord.js v15**: Major version bump likely; check breaking changes (slash commands, intents).
2. **node-pty v2**: API may change; PTY spawn options.
3. **TypeScript v6**: Could introduce stricter checks; fix errors.

Test upgrade in isolated branch before releasing.

---

## Technical Debt Timeline

| Debt Item | When to Address | Why |
|-----------|-----------------|-----|
| Add unit tests | Now (Q2 2026) | Foundation for safe changes |
| Extract constants | Now | Low-hanging fruit |
| Daemon state class | When testability pain high | Test prerequisite |
| Retry logic | When users see transient failures | Reliability |
| Cross-platform | If Claude ships on other OS | Market expansion |
| Logger | When ops need insights | Observability |
| Dead code removal | Next major version | Cleanup |

---

## Bottom Line

This codebase works well for its intended purpose but lacks testing and has some rough edges (Windows-only, global state, magic numbers). The architecture is sound (provider/pipeline separation) and code is readable. Main risk is regression without tests. Priority: **invest in test suite** to enable confident refactoring.

**Debt payoff plan**: Allocate 20% of future sprints to testing and refactoring. Start with parser and utils tests (quick wins).

---

*Last updated*: 2026-03-20
