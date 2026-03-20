# Concerns: Technical Debt, Bugs, Risks

## High-Priority Issues

### 1. Windows-Only Platform

**Status**: Known, documented in README
**Impact**: Excludes macOS/Linux users entirely
**Location**: `src/rc.ts:15` (`claude.exe` hardcoded)
**Recommendation**: Platform detection + binary selection

---

### 2. Zero Automated Tests

**Status**: Critical gap
**Impact**: Manual testing only, regressions likely
**Recommendation**: Start with `jsonl-parser.test.ts`, expand to handlers

---

### 3. execSync Usage (Security)

**Status**: Potential command injection pattern
**Location**: `src/cli.ts:696` (self-update)
```typescript
execSync(`npm install -g ${PKG_NAME}@${latest}`);
```
**Risk**: If `latest` compromised from npm (unlikely but possible)
**Fix**: Use `spawnSync('npm', ['install', '-g', `${PKG_NAME}@${latest}`])`

---

### 4. Race Condition: Daemon Restart

**Location**: `src/daemon.ts:94-97`
```typescript
if (daemonWasEnabled && oldSessionId && oldSessionId !== sessionId) {
  stopDaemon();
  startDaemon();
}
```
**Risk**: Multiple session-register events could leak daemon processes
**Scenario**: User rapidly enables/disables remote, or multiple rc processes compete
**Fix**: Serialize restart with a queue or flag

---

### 5. Unbounded Memory Growth

**Location**: `src/daemon.ts:30-32`
```typescript
let processedUuids = new Set<string>();
let knownUuids = new Set<string>();
```
**Risk**: Long-lived sessions accumulate UUIDs forever (no eviction)
**Impact**: ~40 bytes per UUID × millions = 40+ MB (not critical but unbounded)
**Fix**: Periodic cleanup (e.g., only keep last N) or setMaxSize with LRU

---

### 6. Discouraged Hack: Terminal Restoration

**Location**: `src/rc.ts:33-35`
```typescript
if (process.platform === "win32") {
  process.stdout.write("\x1b[?9001l");
}
```
**Issue**: Undocumented escape sequence for Windows Terminal ConPTY bug
**Risk**: May break in future Windows Terminal versions
**Context**: See `cli.ts:17-20` comment referencing GitHub issues
**Recommendation**: Track Windows Terminal updates, test escape still needed

---

## Moderate Concerns

### 7. Inconsistent Error Handling

**Observation**:
- Some functions: `try/catch` everything, log and continue
- Others: Let errors propagate to top-level crash
- DiscordProvider: `try/catch` but silent on edit/delete failures (okay)

**Impact**: Hard to reason about what failures are fatal vs recoverable
**Recommendation**: Document error handling strategy, use top-level unhandled rejection handler

---

### 8. No Backpressure on Message Bursts

**Location**: `src/daemon.ts:42` (`BATCH_DELAY = 600`)
**Issue**: Large batches (e.g., 100 messages in 500ms) flush together, hitting Discord rate limits (5/5s)
**Current defense**: Rate limiter in DiscordProvider will reject excess
**Better**: Split batches, or check rate limit before flush

---

### 9. Magic Numbers Everywhere

Examples:
- `BATCH_DELAY = 600` (why not 500 or 1000?)
- `KEY_DELAY = 150` (Ink menu navigation timing)
- `MAX_SET_SIZE = 3000` (UUID set capacity?)
- `RATE_WINDOW = 5000`, `RATE_LIMIT = 5` (Discord limits)
- `MAX_MESSAGE_CACHE = 80`, `MAX_THREAD_CACHE = 40`

**Issue**: No rationale, hard to tune
**Fix**: Move to `src/constants.ts` with JSDoc explaining each value

---

### 10. Global Mutable State

**Location**: Module-level `let` variables in `daemon.ts`, `rc.ts`
**Issue**: Makes testing hard (state leaks between tests if module cached)
**Fix**: Encapsulate in class (`Daemon`, `ParentProcess`) with instance fields

---

### 11. Dead Code

- `src/discord-hook.js` – not used in current architecture
- `PIPE_REGISTRY` directory and logic – used only by discord-hook (legacy)?
- `src/session-hook.js` – minimal, could merge with state-hook

**Impact**: Confusion, extra maintenance burden
**Fix**: Remove truly dead, comment deprecated

---

### 12. Stale Pipe Registry Cleanup Race

**Location**: `src/pipe-client.ts:23-30`
```typescript
process.kill(entry.pid, 0); // check alive
return entry.pipe;          // might die before caller uses
```
**Race**: Process could die after check, before socket connection.
**Impact**: Connection error (self-handled, but adds noise)
**Fix**: Accept that race is fine, or retry more times.

---

### 13. Slash Commands One-Shot Registration

**Location**: `daemon.ts` – calls `setupSlashCommands()` on startup
**Issue**: If Discord API call fails (network), commands won't be registered. No retry.
**Impact**: Users won't have `/mode`, `/status`, etc.
**Fix**: Retry with backoff, or check on first interaction and register then.

---

### 14. Long JSONL Replay Slow

**Location**: `daemon.ts:walkCurrentBranch()`
```typescript
// Reads entire file to find last position, then replays missed lines
```
**Issue**: Multi-megabyte transcripts → slow startup (seconds)
**Fix**: Cap replay to last N lines (e.g., 1000), or store byte offset.

---

## Low-Priority / Future Work

### 15. No Authentication on IPC Pipe

**Issue**: Any local process can send to named pipe (no ACL)
**Risk**: Low (local user already has full access)
**Would be nice**: Windows security descriptor, or validate sender PID

---

### 16. Discord API Version Lock

- `discord.js` pinned at ^14.18.0 (minor updates only)
- Discord API changes could break without warning
- No dependency update automation (Dependabot/Renovate)

---

### 17. Excessive Console.log in Production

Count: 30+ `console.log`/`console.error` statements
- Normal in daemon for debugging
- Could become noise in high-volume sessions
- Consider structured logging or log level flag

---

### 18. Missing Config Validation

`loadConfig()` just parses JSON, no schema validation.
If user manually edits config.json and typo fields, runtime errors ensue.
**Fix**: Simple check: `if (!config.discordBotToken || !config.guildId) throw...`

---

## Risks & Mitations

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Windows Terminal breaks PTY restore | Medium | High | Track upstream bug, update escape sequence |
| Discord API breaking change | Medium | High | Pin discord.js minor, test before upgrade |
| npm registry compromise (self-update) | Low | Critical | Use npm's signatures, execFile pattern |
| UUID set OOM | Low | Medium | Periodic prune, or max size |
| Daemon leak on rapid toggle | Medium | Medium | Idempotent restart, flag check |

---

## Observed Bugs (from Usage)

*(None documented yet – this section for user-reported bugs)*

---

## Refactoring Candidates

1. **DaemonState class** – encapsulate globals
2. **Constants module** – collect all magic numbers
3. **Retry wrapper** – decorator for Discord API calls
4. **Rate limiter abstraction** – reusable token bucket
5. **Logging abstraction** – allow log levels, file output
6. **CachedDiscordProvider** – separate cache layer

---

## Technical Debt Metrics

- **Test coverage**: 0%
- **ESLint**: Not configured
- **Prettier**: Not configured
- **Dependabot**: Not enabled
- **Code comments**: Sparse, mostly in complex areas only

---

## What Would Make This Production-Grade?

1. ✅ Unit tests (>80% coverage)
2. ✅ Cross-platform support (macOS/Linux)
3. ✅ Observability (structured logs, metrics)
4. ✅ Configuration validation + migration
5. ✅ Retry logic + circuit breakers for Discord API
6. ✅ Security audit (IPC auth, input sanitization)
7. ✅ Auto-dependency updates
8. ✅ User documentation for error scenarios
9. ✅ Graceful degradation on Discord outages
10. ✅ Package for Windows/macOS/Linux separately (electron bundler?)

---

**Last updated**: 2026-03-20
