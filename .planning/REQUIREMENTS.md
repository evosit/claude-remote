# Requirements: Linux Support for claude-remote

**Milestone**: v2.0 — Cross-platform support
**Target platforms**: Linux (Ubuntu 20.04+, Debian 10+, Alpine 3.19+), macOS (tbd)
**Based on research**: `.planning/research/` (2025-03-20)

---

## Vision Statement

Enable developers on Linux (and eventually macOS) to use `claude-remote` to control Claude Code from Discord, with feature parity and reliability comparable to the Windows experience.

---

## Core Objectives

1. **Cross-platform PTY**: Spawn Claude Code CLI in pseudo-terminal on any OS
2. **Platform-agnostic IPC**: Reliable bidirectional communication between parent and daemon
3. **Universal shell integration**: Seamless `claude` alias installation across shells
4. **Zero Windows regression**: All existing Windows functionality must continue working
5. **Linux-first UX**: Installation and setup feel native on Linux

---

## Functional Requirements

### FR-1: Platform Detection & Abstraction

**Priority**: P1 (critical)
**Description**: Create platform abstraction layer that detects OS and returns appropriate values for:
- Binary name: `claude.exe` (Windows) vs `claude` (Linux/macOS)
- IPC path: Windows named pipe (`\\.\pipe\...`) vs Unix domain socket (`/tmp/...sock`)
- Shell profile paths: Windows profiles vs Linux (`~/.bashrc`, `~/.zshrc`, `~/.config/fish/config.fish`)

**Acceptance criteria**:
- `src/platform.ts` module exports:
  - `getClaudeBinary(): string`
  - `getPipePath(): string`
  - `getShellProfiles(): Array<{path: string, line: string}>`
- All platform checks use `process.platform` (`win32` vs `linux`/`darwin`)
- No hardcoded Windows assumptions remain in `rc.ts`, `pipe-client.ts`, `cli.ts`

**References**: STACK.md (lines 1-50), ARCHITECTURE.md (Platform Abstraction section)

---

### FR-2: Unix Domain Socket IPC

**Priority**: P1 (critical)
**Description**: Replace Windows named pipes with Unix domain sockets for parent-daemon communication on non-Windows platforms.

**Acceptance criteria**:
- Parent (`rc.ts`) creates socket server at path from `getPipePath()`
- On Linux, socket file is cleaned up on exit (to avoid stale files)
- Daemon connects using same path (via `CLAUDE_REMOTE_PIPE` env or `findPipe()`)
- `pipe-client.ts:findPipe()` discovers socket by scanning `~/.claude/claude-remote/pipe-registry/` JSON files (unchanged) AND handles `.sock` file existence
- Socket file permissions set to `0600` (user-only)
- Works with `net.createConnection(path)` on Linux

**Edge cases**:
- Socket already exists (stale from crash) → unlink before `listen()`
- Permission denied on `/tmp` → fallback to `os.tmpdir()` or `~/.config/claude-remote/`
- Abstract namespace sockets (Linux-only) considered but not required

**References**: PITFALLS.md (Pitfall 1), FEATURES.md (IPC line), ARCHITECTURE.md (IPC section)

---

### FR-3: Cross-platform PTY Spawning

**Priority**: P1 (critical)
**Description**: Ensure `node-pty.spawn()` works on Linux with the correct binary and options.

**Acceptance criteria**:
- `rc.ts` uses `getClaudeBinary()` to determine executable name
- PTY options: `name: "xterm-256color"` (better Unicode support than `xterm-color`)
- No ConPTY-specific escape sequences on Linux (already guarded by `if (process.platform === 'win32')`)
- Signal handling works: `SIGINT`, `SIGTERM` properly forwarded to Claude process
- Terminal resize works (rows/cols updated)

**Testing**:
- Start `claude-remote` on Linux → Claude CLI appears in terminal
- Can type prompts, see responses
- Ctrl+C cleanly exits

**References**: STACK.md (PTY section), PITFALLS.md (Pitfall 2, Pitfall 4)

---

### FR-4: Linux Shell Alias Installation

**Priority**: P1 (critical)
**Description**: Extend `cli.ts:getAliasTargets()` to install `claude` alias for common Linux shells.

**Acceptance criteria**:
- Detects installed shells by checking existence of profile files:
  - Bash: `~/.bashrc` (always), `~/.bash_profile` (if exists)
  - Zsh: `~/.zshrc`
  - Fish: `~/.config/fish/config.fish`
- Appends alias line if not already present:
  - Bash/Zsh: `alias claude='claude-remote'`
  - Fish: `alias claude='claude-remote'`
- Idempotent: running install twice does not duplicate entries
- Uninstall removes from all detected profiles
- Does NOT modify system files (e.g., `/etc/profile`) — user-only

**Edge cases**:
- Shell config files may not exist yet → create parent directory
- Multiple shells detected → install to all (user expects alias in their preferred shell)
- User manually edits and breaks the marker comment → our uninstall may miss; acceptable

**References**: FEATURES.md (Shell alias installation), PITFALLS.md (Pitfall 8)

---

### FR-5: Configuration Paths (XDG Compliance)

**Priority**: P2 (high)
**Description**: Ensure configuration directories follow platform conventions.

**Acceptance criteria**:
- Config dir: `~/.config/claude-remote/` on Linux (XDG), `%APPDATA%\claude-remote` on Windows (already)
- Use `os.homedir()` + platform check
- Fallback to `~/.claude-remote/` if `~/.config` not writable? (Optional)
- All file operations use `path.join()` with correct separators

**Implementation**:
```typescript
const CONFIG_DIR = process.platform === 'win32'
  ? path.join(os.homedir(), 'AppData', 'Roaming', 'claude-remote')
  : path.join(os.homedir(), '.config', 'claude-remote');
```

**References**: PITFALLS.md (Pitfall 5)

---

### FR-6: Environment Variable Validation

**Priority**: P2 (high)
**Description**: Early detection of missing Discord bot configuration.

**Acceptance criteria**:
- On daemon startup (before forking), check:
  - `DISCORD_BOT_TOKEN` (starts with `MT`? Rough check)
  - `DISCORD_GUILD_ID` (non-empty string)
  - `DISCORD_CATEGORY_ID` (non-empty string)
- If missing, log clear error and exit with code 1
- `rc.ts` should detect daemon exit and propagate to user

**References**: PITFALLS.md (Pitfall 9)

---

### FR-7: Line Ending Normalization

**Priority**: P2 (high)
**Description**: JSONL parser must handle both LF and CRLF line endings.

**Acceptance criteria**:
- `jsonl-parser.ts:parseJSONLString()` uses `split(/\r?\n/)` instead of `split('\n')`
- Tested with Windows-generated CRLF JSONL on Linux
- No `SyntaxError: Unexpected token` from stray `\r`

**References**: PITFALLS.md (Pitfall 6)

---

### FR-8: Signal Handling on Linux

**Priority**: P2 (high)
**Description**: Handle Unix signals correctly, avoid zombie processes.

**Acceptance criteria**:
- Ignore `SIGPIPE` (Linux sends when writing to closed socket) to prevent daemon crash
- `SIGTERM` and `SIGINT` properly terminate both parent and daemon
- Parent waits for daemon to exit (with timeout) before exiting itself
- No orphaned Claude processes when parent killed

**References**: PITFALLS.md (Pitfall 4)

---

### FR-9: File Watching Robustness

**Priority**: P2 (high)
**Description**: Ensure `chokidar` works reliably on Linux with large files and truncation.

**Acceptance criteria**:
- Watcher detects JSONL truncation/rewind (size decreases) and replays from beginning
- Configurable `usePolling: true` fallback if inotify limits hit (document how to enable)
- Warn if `fs.inotify.max_user_watches` is too low (common on large projects)
- Debounce (600ms) prevents excessive processing on bursts

**References**: PITFALLS.md (Pitfall 2), FEATURES.md (File watching)

---

### FR-10: Node.js Version Enforcement

**Priority**: P2 (high)
**Description**: Require Node.js 18+ (discord.js v14 minimum).

**Acceptance criteria**:
- CLI startup checks `process.version` and exits with clear error if <18
- `package.json` `engines` field specifies `>=18.0.0`
- Documentation states requirement

**References**: PITFALLS.md (Pitfall 18)

---

## User Experience Requirements

### UX-1: Installation Documentation

**Priority**: P1 (critical)
**Description**: Clear, accurate Linux install instructions.

**Acceptance criteria**:
- README.md has "Installation on Linux" section covering:
  - Prerequisites: Node.js 18+, build-essential (for node-pty), Claude Code CLI install
  - npm global install with user prefix (no sudo)
  - Setup wizard (`claude-remote setup`) works on Linux
  - Environment variable configuration (`.env` file or export)
  - Starting first session (`claude-remote -p "hello"`)

**Non-functional**:
- Document distro-specific notes (Ubuntu/Debian/Alpine/Fedora)
- Troubleshooting: common errors (EACCES, command not found, Claude binary missing)

---

### UX-2: Shell Integration Discovery

**Priority**: P2 (high)
**Description**: Setup should detect available shells and inform user what it's doing.

**Acceptance criteria**:
- `claude-remote setup` prints:
  - "Detected shells: bash, zsh"
  - "Installing alias to ~/.bashrc"
  - "Installing alias to ~/.zshrc"
  - "Please restart your shell or run `source ~/.bashrc`"
- If no known shells detected, warn user and provide manual instructions

---

### UX-3: Clear Error Messages

**Priority**: P2 (high)
**Description**: Errors should guide user to fix, not just log to console.

**Acceptance criteria**:
- Missing `claude` binary → "Claude Code CLI not found in PATH. Install from https://claude.ai/install"
- Missing Discord env vars → "Missing DISCORD_BOT_TOKEN. Set it in ~/.config/claude-remote/.env or export it."
- Socket permission denied → "Cannot create IPC socket in /tmp. Check permissions or set TMPDIR."
- Inotify limit exceeded → "File watch limit reached. Increase fs.inotify.max_user_watches via sysctl."

---

## Non-Functional Requirements

### NFR-1: Compatibility

- **Windows**: Must continue to work exactly as before (no regressions)
- **Linux**: Support glibc-based distros (Ubuntu, Debian, Fedora). Alpine (musl) optional but desirable.
- **macOS**: Stretch goal for v2.0; may be deferred to v2.1

### NFR-2: Security

- Socket file permissions: `0600` (owner read/write only)
- Config files: user-writable only (no world-readable tokens)
- No new privileged operations (setuid, capabilities)
- No changes to Windows ACL semantics

### NFR-3: Performance

- Startup time: <2s from `claude-remote` to daemon running
- Memory footprint: <100 MB (excluding Claude itself)
- No CPU spin loops; event-driven architecture preserved

### NFR-4: Reliability

- Daemon crash → parent restarts it (already implemented)
- Socket cleanup on abnormal exit (use `process.on('exit')` and `unlink`)
- JSONL truncation recovery (replay from beginning)
- Graceful degradation: Discord API failures logged but don't crash

---

## Out of Scope (v1)

- **macOS support** (may be v2.1+)
- **WSL2 special handling** (document separately if needed)
- **Package manager distribution** (apt/yum/brew formulas) — users install via npm
- **systemd --user service** (nice-to-have but not required for initial Linux release)
- **Desktop notifications** (conditional on libnotify availability)
- **Shell completion scripts** (can add later)
- **Global (system-wide) installation** — user-level only
- **Root/privileged operations** — never require sudo

---

## Success Criteria

- ✅ `claude-remote` installs via npm on Linux without errors
- ✅ `claude-remote setup` completes successfully on Linux
- ✅ Discord bot connects, channel created
- ✅ User message from Discord appears in Claude
- ✅ Claude response appears in Discord (with rich formatting)
- ✅ Tool approvals (Allow/Deny) work
- ✅ File edits render as diffs
- ✅ Long output goes to threads
- ✅ `/remote on/off/status` commands work
- ✅ `/stop` and `/clear` work
- ✅ Alias `claude` works in bash/zsh/fish
- ✅ No regressions on Windows (tested concurrently)

---

## Dependencies

- **node-pty**: Already supports Linux; no change needed
- **discord.js**: Cross-platform; no change needed
- **chokidar**: Cross-platform; no change needed
- **Claude Code CLI**: Must be installed separately by user (`curl -fsSL https://claude.ai/install.sh | bash`)

---

## Open Questions

1. **Socket location**: Should we use `/tmp` or `$XDG_RUNTIME_DIR`? `/tmp` simplest but may have permission issues on some distros. **Decision**: Use `/tmp` for v1, document fallback.
2. **Alpine support**: node-pty may require compilation. Should we officially support Alpine? **Decision**: Test in CI; if builds fail, document as "glibc-based distros only".
3. **systemd service**: Include as opt-in? **Decision**: Defer to v2.0.1 or v2.1.

---

**Next**: Create phased ROADMAP.md breaking down implementation into manageable chunks with verification criteria.
