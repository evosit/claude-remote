# Phase 1 Research: Platform Abstraction

**Researched:** 2025-03-20 (synthesized from existing domain research)
**Phase:** 1 — Platform Abstraction (P1)
**Goal:** Create abstraction layer and fix critical blockers (IPC, binary, paths)

---

## Executive Summary

Phase 1 addresses the critical blockers that prevent claude-remote from running on Linux:

1. **IPC transport** — Windows named pipes → Unix domain sockets
2. **Binary detection** — `claude.exe` → `claude`
3. **Shell alias installation** — Windows shells → bash/zsh/fish
4. **Platform abstraction** — Centralize all platform-specific logic in `platform.ts`
5. **Socket cleanup** — Remove stale `.sock` files on exit
6. **Configuration consistency** — Review path usage across modules

All six tasks are straightforward with low-to-medium risk. The existing node-pty, chokidar, and discord.js dependencies are cross-platform. No architectural changes required.

---

## Technical Approach per Task

### P1.1: Create `src/platform.ts`

**Objective:** Centralize platform detection and value generation.

**Implementation:**

Create `src/platform.ts` with these exports:

```typescript
import { homedir } from 'node:os';
import { join } from 'node:path';

export function getPlatform(): 'win32' | 'linux' | 'darwin' {
  return process.platform as 'win32' | 'linux' | 'darwin';
}

export function getClaudeBinary(): string {
  return getPlatform() === 'win32' ? 'claude.exe' : 'claude';
}

export function getPipePath(): string {
  const pid = process.pid;
  if (getPlatform() === 'win32') {
    return `\\\\.\\pipe\\claude-remote-${pid}`;
  }
  // Linux/macOS: use /tmp (or /private/tmp on macOS)
  const tmpDir = getPlatform() === 'darwin' ? '/private/tmp' : '/tmp';
  return join(tmpDir, `claude-remote-${pid}.sock`);
}

export function getConfigDir(): string {
  const home = homedir();
  if (getPlatform() === 'win32') {
    return join(home, 'AppData', 'Roaming', 'claude-remote');
  }
  // XDG compliance on Linux/macOS
  return join(home, '.config', 'claude-remote');
}

export function getShellProfiles(): Array<{ path: string; line: string; marker: string }> {
  const home = homedir();
  const ALIAS_MARKER = '# claude-remote alias — do not edit manually';

  if (getPlatform() === 'win32') {
    // Existing Windows logic (unchanged for now)
    return [];
  }

  // Linux/macOS
  const targets: Array<{ path: string; line: string; marker: string }> = [];

  // Bash (~/.bashrc)
  const bashrc = join(home, '.bashrc');
  targets.push({
    path: bashrc,
    line: `alias claude='claude-remote' ${ALIAS_MARKER}`,
    marker: ALIAS_MARKER,
  });

  // Zsh (~/.zshrc)
  const zshrc = join(home, '.zshrc');
  targets.push({
    path: zshrc,
    line: `alias claude='claude-remote' ${ALIAS_MARKER}`,
    marker: ALIAS_MARKER,
  });

  // Fish (~/.config/fish/config.fish)
  const fishConfig = join(home, '.config', 'fish', 'config.fish');
  targets.push({
    path: fishConfig,
    line: `alias claude='claude-remote' ${ALIAS_MARKER}`,
    marker: ALIAS_MARKER,
  });

  // Note: These will be filtered later based on file existence
  return targets;
}

export function shouldCleanupSocket(): boolean {
  return getPlatform() !== 'win32';
}
```

**Acceptance:**
- Unit tests for each function (mock `process.platform`)
- All return values match specification for Linux target

**Reference:** STACK.md (lines 36-46), PITFALLS.md (lines 29-38)

---

### P1.2: Update `src/rc.ts` – Socket & Binary

**Objective:** Replace hardcoded Windows values with platform-aware functions.

**Changes needed:**

1. **Import platform module:**
```typescript
import * as platform from './platform';
```

2. **Replace constants:**
```typescript
// Remove:
// const PIPE_NAME = `\\\\.\\pipe\\claude-remote-${process.pid}`;
// const CLAUDE_BIN = "claude.exe";

// Use:
const PIPE_PATH = platform.getPipePath();
const CLAUDE_BIN = platform.getClaudeBinary();
```

3. **Socket server start:**
```typescript
// Existing: pipeServer.listen(PIPE_NAME);
// Change to:
pipeServer.listen(PIPE_PATH);
```

4. **Socket cleanup on non-Windows (before listen and on exit):**
```typescript
if (platform.shouldCleanupSocket()) {
  try { fs.unlinkSync(PIPE_PATH); } catch { /* ignore if not exists */ }
}
```

Also register cleanup on process exit:
```typescript
process.on('exit', () => {
  if (platform.shouldCleanupSocket()) {
    try { fs.unlinkSync(PIPE_PATH); } catch {}
  }
});
```

5. **Binary existence check (optional but recommended):**
Before `pty.spawn()`, verify `CLAUDE_BIN` is in PATH:

```typescript
import { which } from 'which';

function verifyClaudeInPath(): string | null {
  try {
    return which.sync(CLAUDE_BIN);
  } catch {
    return null;
  }
}

// In start() before spawn:
const claudePath = verifyClaudeInPath();
if (!claudePath) {
  console.error(`Claude binary '${CLAUDE_BIN}' not found in PATH`);
  if (getPlatform() !== 'win32') {
    console.error('Install Claude Code: curl -fsSL https://claude.ai/install.sh | bash');
  } else {
    console.error('Install Claude Code from https://claude.ai/install');
  }
  process.exit(1);
}
```

**Acceptance:**
- Parent starts on Linux → socket created at `/tmp/claude-remote-<pid>.sock`
- Socket removed on exit
- No `EADDRNOTAVAIL` errors
- `claude` binary spawned correctly (verify `which claude`)

**Reference:** STACK.md (lines 48-50, 56-86), PITFALLS.md (lines 11-38)

---

### P1.3: Update `src/pipe-client.ts` – Socket Discovery

**Objective:** Make `findPipe()` work with both Windows pipes and Unix sockets.

**Current logic:** Read pipe registry JSON files (unchanged) and attempt connection.

**Changes needed:**

1. **Handle socket path existence check for Linux:**

The `findPipe()` function should check if `entry.pipe` path exists as a socket file on Linux:

```typescript
function findPipe(): { pipe: string; pid: number } | null {
  const registryDir = path.join(platform.getConfigDir(), 'pipe-registry');
  // ... read JSON files ...

  for (const entry of candidates) {
    // On Linux, check if socket file exists
    if (platform.shouldCleanupSocket()) {
      try {
        // stat will fail if socket doesn't exist
        fs.statSync(entry.pipe);
      } catch {
        // Socket file missing → stale entry, skip
        continue;
      }
    }

    // Also: if PID not running, skip (existing logic)
    if (process.kill(entry.pid, 0)) {
      return entry;
    }
  }

  return null;
}
```

2. **`sendPipeMessage()`:** `net.createConnection(pipeName)` already works for both Windows pipes and Unix sockets — no change needed.

3. **Timeout:** Already present (3 seconds) — verify.

**Acceptance:**
- `claude-remote status` connects successfully on Linux
- Stale socket files/entries cleaned automatically

**Reference:** STACK.md (lines 71-85), PITFALLS.md (lines 11-21, 46-57)

---

### P1.4: Update `src/daemon.ts` – Config Dir & Signals

**Objective:** Use platform abstraction for config dir; add SIGPIPE ignore.

**Changes:**

1. **Config dir:**
```typescript
import { getConfigDir } from './platform';

// Replace hardcoded '~/.claude/claude-remote' with getConfigDir()
const CONFIG_DIR = getConfigDir();
```

**Decision:** Keep config at `~/.claude/claude-remote`? No — use `getConfigDir()` which returns XDG path on Linux (`~/.config/claude-remote`). This aligns with platform conventions.

2. **SIGPIPE ignore (Linux only):**
```typescript
import { getPlatform } from './platform';

if (getPlatform() !== 'win32') {
  process.on('SIGPIPE', () => {}); // Ignore
}
```

**Placement:** At top of daemon entry point.

3. **Environment passing:** Already passes env from parent — no change needed.

**Acceptance:**
- Daemon starts without crashing on SIGPIPE
- Config dir created at `~/.config/claude-remote` on Linux

**Reference:** PITFALLS.md (lines 245-325), STACK.md (lines 88-100)

---

### P1.5: Update `src/cli.ts` – Setup Wizard for Linux

**Objective:** Extend `getAliasTargets()` to return Linux shell profiles; ensure install/uninstall works.

**Changes:**

1. **Refactor `getAliasTargets()`:**

Replace Windows-only logic with conditional:

```typescript
function getAliasTargets(): AliasTarget[] {
  const targets: AliasTarget[] = [];
  const platform = getPlatform(); // import from platform.ts

  if (platform === 'win32') {
    // Existing Windows detection (PowerShell, Git Bash, CMD)
    // ... keep existing code ...
  } else {
    // Linux/macOS
    const home = os.homedir();
    const ALIAS_MARKER = '# claude-remote alias — do not edit manually';

    const shells = [
      { name: 'bash', path: join(home, '.bashrc'), line: `alias claude='claude-remote' ${ALIAS_MARKER}` },
      { name: 'zsh', path: join(home, '.zshrc'), line: `alias claude='claude-remote' ${ALIAS_MARKER}` },
      { name: 'fish', path: join(home, '.config', 'fish', 'config.fish'), line: `alias claude='claude-remote' ${ALIAS_MARKER}` },
    ];

    // Only include profiles that exist
    for (const shell of shells) {
      if (fs.existsSync(shell.path)) {
        targets.push({
          shell: shell.name as const,
          profilePath: shell.path,
          aliasLine: shell.line,
          marker: ALIAS_MARKER,
        });
      }
    }
  }

  return targets;
}
```

2. **Ensure `installAlias()` works with Linux paths:**
- Create parent directory if needed (e.g., `~/.config/fish` may not exist)
- Idempotency via marker comment — ensure marker is unique and detection works

```typescript
function installAlias(target: AliasTarget): boolean {
  // Create parent directory if missing
  fs.mkdirSync(path.dirname(target.profilePath), { recursive: true });

  const content = fs.readFileSync(target.profilePath, 'utf-8');
  if (content.includes(target.marker)) {
    return false; // Already installed
  }

  fs.appendFileSync(target.profilePath, `\n${target.aliasLine}\n`);
  return true;
}
```

3. **Uninstall:** Remove lines between markers (existing logic should work).

**Acceptance:**
- `claude-remote setup` on Linux detects available shells (bash, zsh, fish) based on file existence
- Aliases appended to correct files
- Running install twice → no duplicate
- `claude-remote uninstall` removes alias lines

**Reference:** FEATURES.md (lines 90-141), PITFALLS.md (lines 80-110)

---

### P1.6: Update `src/utils.ts` – Platform Constants

**Objective:** Remove hardcoded platform constants; use `platform.ts` everywhere.

**Audit `utils.ts`:**

- If `CONFIG_DIR` or similar constants exist, replace with `platform.getConfigDir()`
- Search codebase for any other hardcoded Windows paths

**Changes:**

```typescript
// Before:
export const CONFIG_DIR = path.join(os.homedir(), '.claude', 'claude-remote');

// After: remove CONFIG_DIR entirely; import from platform:
export { getConfigDir as getConfigDirPlatform } from './platform';
// Or just remove and have callers import directly from platform.ts
```

Better approach: Remove `CONFIG_DIR` from `utils.ts` entirely. Update all files that import it to use `platform.getConfigDir()` instead.

Files likely using CONFIG_DIR:
- `rc.ts`
- `pipe-client.ts`
- `daemon.ts`
- `cli.ts`

Audit each and update.

**Acceptance:**
- No remaining references to `CONFIG_DIR` or hardcoded `~/.claude/claude-remote`
- All path construction uses `platform` helpers or `path.join` with `os.homedir()`

---

## Dependencies Between Tasks

```
P1.1 (platform.ts) → P1.2, P1.3, P1.4, P1.5, P1.6 all depend on it
P1.2 and P1.3 are closely coupled (IPC server vs client)
P1.4 depends on P1.1 (config dir)
P1.5 depends on P1.1 (shell profiles)
P1.6 depends on P1.1 (config dir)
```

**Execution order:**
1. P1.1: Create `platform.ts` (foundation)
2. P1.2: Update `rc.ts` (IPC server)
3. P1.3: Update `pipe-client.ts` (IPC client)
4. P1.4: Update `daemon.ts` (config + signals)
5. P1.5: Update `cli.ts` (setup wizard)
6. P1.6: Clean up `utils.ts` (remove constants)

All tasks can be in **Wave 1** (no independent parallelism) since P1.1 blocks everything. However, once P1.1 is done, P1.2, P1.3, P1.4, P1.5, P1.6 could technically be done in parallel since they modify different files. But they all rely on the same new module; as long as that's committed, they could be split into waves. For simplicity, keep as single wave.

---

## Risks and Edge Cases

### Risk 1: Socket file permission

Unix sockets are subject to filesystem permissions. Default `0600` (owner-only) is fine since daemon runs as same user.

**Mitigation:** No action needed; `net.Server` on Unix socket uses `0600` automatically.

### Risk 2: Stale socket files from crashes

If daemon crashes without cleanup, socket file remains. `listen()` would fail with `EADDRINUSE`.

**Mitigation:** Already covered — cleanup before `listen()` (`fs.unlinkSync` if exists).

### Risk 3: `getShellProfiles()` returns non-existent paths

We filter by `fs.existsSync()` in `cli.ts`. Ensure that logic remains or add filtering in `getShellProfiles()` itself. Current design includes existence check in `getAliasTargets()`, so OK.

### Risk 4: Underlying `node-pty` compilation on Linux

`node-pty` has native C++ code. If user lacks build tools (`build-essential`, `python3`, `g++`), `npm install` fails.

**Mitigation:** Document prerequisites in README (Phase 4 task). Not blocking Phase 1 implementation.

### Risk 5: Windows regression

All changes must maintain Windows functionality.

**Mitigation:**
- Use `process.platform` checks everywhere
- Keep Windows-specific code paths intact
- After Phase 1, test on Windows (phase verification checklist)

### Risk 6: Config dir migration

If existing users have config in `~/.claude/claude-remote`, changing to XDG would break them.

**Decision per STACK.md:** Keep `~/.claude/claude-remote` for consistency with Claude's own config? Actually, REQUIREMENTS.md FR-5 says XDG compliance is P2, not P1. So we should **keep existing config dir** for now to avoid migration.

**Implementation:** In `platform.getConfigDir()`, return:
- Windows: `%APPDATA%\claude-remote` (existing)
- Linux/macOS: `~/.claude/claude-remote` (NOT XDG yet — keep current for v1)

So `getConfigDir()` for Linux should return `join(os.homedir(), '.claude', 'claude-remote')` for now. XDG compliance can be a later phase (P2).

**Correction:** STACK.md line 148 says "No changes to: Config dir `~/.claude-remote`". So we keep existing config dir unchanged in Phase 1.

Update `platform.ts` accordingly:
```typescript
export function getConfigDir(): string {
  const home = homedir();
  if (getPlatform() === 'win32') {
    return join(home, 'AppData', 'Roaming', 'claude-remote');
  }
  // Keep current Linux config location for v1
  return join(home, '.claude', 'claude-remote');
}
```

This ensures no breaking change.

---

## Verification Criteria

After completing Phase 1 tasks, run this checklist on Linux:

- [ ] `npm run build` succeeds without errors
- [ ] `src/platform.ts` exists and exports all functions
- [ ] `rc.ts` uses `getPipePath()`, `getClaudeBinary()`, `shouldCleanupSocket()`
- [ ] Socket file created at `/tmp/claude-remote-<pid>.sock` (verify with `ls /tmp/claude-remote-*.sock`)
- [ ] Socket file removed after exit
- [ ] `pipe-client.ts` finds socket correctly (test `claude-remote status`)
- [ ] `daemon.ts` uses `getConfigDir()` (config dir remains `~/.claude/claude-remote`)
- [ ] `daemon.ts` registers `SIGPIPE` ignore on non-Windows
- [ ] `cli.ts` `getAliasTargets()` includes bash/zsh/fish with correct paths
- [ ] `cli.ts` installs alias to `~/.bashrc` or `~/.zshrc` if files exist
- [ ] `utils.ts` no longer exports `CONFIG_DIR` (or it's no longer used elsewhere)
- [ ] All imports resolve correctly (`platform` module)

---

## References to Codebase

- `src/rc.ts` — parent process, IPC server, PTY spawn
- `src/pipe-client.ts` — pipe discovery, sendPipeMessage
- `src/daemon.ts` — daemon process, config dir, file watching
- `src/cli.ts` — CLI commands, setup wizard, alias install/uninstall
- `src/utils.ts` — constants (CONFIG_DIR, etc.)
- `.planning/research/STACK.md` — implementation checklist (lines 170-198)
- `.planning/research/PITFALLS.md` — critical pitfalls 1-4, 8, 17-19
- `.planning/research/FEATURES.md` — feature prioritization, MVP definition
- `.planning/REQUIREMENTS.md` — FR-1, FR-2, FR-3, FR-4, UX-1

---

## Nyquist Validation Architecture

This phase requires validation of **Dimension 6: Verification completeness**:

**Verification Loop Approach:**

Manual integration testing on a Linux VM or WSL2:

1. Build and install:
   ```bash
   npm run build
   npm install -g --prefix ~/.npm-global .
   export PATH=~/.npm-global/bin:$PATH
   ```

2. Install Claude Code CLI if not present:
   ```bash
   curl -fsSL https://claude.ai/install.sh | bash
   ```

3. Setup Discord bot:
   ```bash
   claude-remote setup
   # Enter bot token, guild ID, category ID
   ```

4. Test alias:
   ```bash
   source ~/.bashrc  # or ~/.zshrc
   claude-remote --version
   ```

5. Start daemon:
   ```bash
   claude-remote -p "test"
   ```

6. Verify:
   - Socket file exists in `/tmp`
   - Daemon connects to Discord
   - Messages flow both ways
   - `/remote on/off/status` work
   - `/stop` and `/clear` work

7. Cleanup:
   ```bash
   claude-remote uninstall
   ```

Automated unit tests for `platform.ts` can be added if test framework exists.

---

## Conclusion

Phase 1 is low-risk, high-clearance work. The research is conclusive. Planning should produce 6 tasks (one per subtask) with clear acceptance criteria referencing the checklist above.

**Key decisions:**
- Keep existing config dir (`~/.claude/claude-remote`) for v1 — no XDG migration yet
- Use `/tmp` for socket location (simplest, works on Linux/macOS)
- Socket cleanup mandatory on non-Windows
- `node-pty` works without modification — just binary name change

**Next:** Plan Phase 1 into executable PLAN.md files with verification loop.
