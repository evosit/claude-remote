---
title: Platform Abstraction Implementation
description: Phase 1: Create cross-platform abstraction layer (socket IPC, binary detection, shell profiles)
wave: 1
depends_on: []
files_modified:
  - src/platform.ts
  - src/rc.ts
  - src/pipe-client.ts
  - src/daemon.ts
  - src/cli.ts
  - src/utils.ts
autonomous: false
requirements:
  - FR-1
  - FR-2
  - FR-3
  - FR-4
  - UX-1
---

## Phase 1: Platform Abstraction — Detailed Plan

**Total estimated effort:** 7.5 hours (6 tasks)
**Wave structure:** Single wave (all tasks independent after P1.1 foundation)
**Dependencies:** P1.1 must be completed before P1.2-P1.6 (they all import `platform.ts`)

### Task P1.1: Create `src/platform.ts` (2h)

**Goal:** Implement platform abstraction module with all helper functions.

<read_first>
- .planning/phases/01-platform-abstraction/01-RESEARCH.md (implementation guidance)
- src/ (existing file structure)
</read_first>

<action>
Create `src/platform.ts` with exact content:

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
  const tmpDir = getPlatform() === 'darwin' ? '/private/tmp' : '/tmp';
  return join(tmpDir, `claude-remote-${pid}.sock`);
}

export function getConfigDir(): string {
  const home = homedir();
  if (getPlatform() === 'win32') {
    return join(home, 'AppData', 'Roaming', 'claude-remote');
  }
  // Keep existing config location for v1 (no XDG migration yet)
  return join(home, '.claude', 'claude-remote');
}

export function getShellProfiles(): Array<{ path: string; line: string; marker: string }> {
  const home = homedir();
  const ALIAS_MARKER = '# claude-remote alias — do not edit manually';

  if (getPlatform() === 'win32') {
    return []; // Windows shells handled separately in cli.ts
  }

  const targets: Array<{ path: string; line: string; marker: string }> = [];

  // Bash
  targets.push({
    path: join(home, '.bashrc'),
    line: `alias claude='claude-remote' ${ALIAS_MARKER}`,
    marker: ALIAS_MARKER,
  });

  // Zsh
  targets.push({
    path: join(home, '.zshrc'),
    line: `alias claude='claude-remote' ${ALIAS_MARKER}`,
    marker: ALIAS_MARKER,
  });

  // Fish
  targets.push({
    path: join(home, '.config', 'fish', 'config.fish'),
    line: `alias claude='claude-remote' ${ALIAS_MARKER}`,
    marker: ALIAS_MARKER,
  });

  return targets;
}

export function shouldCleanupSocket(): boolean {
  return getPlatform() !== 'win32';
}
```
</action>

<acceptance_criteria>
- `grep 'export function getPlatform()' src/platform.ts` matches `: 'win32' | 'linux' | 'darwin'`
- `grep 'export function getClaudeBinary()' src/platform.ts` returns 'claude.exe' for Windows, 'claude' otherwise
- `grep 'export function getPipePath()' src/platform.ts` exists and includes '/tmp' for non-Windows
- `grep 'export function getConfigDir()' src/platform.ts` exists and returns correct path for each platform
- `grep 'export function getShellProfiles()' src/platform.ts` returns array with bash/zsh/fish entries
- `grep 'export function shouldCleanupSocket()' src/platform.ts` returns `platform !== 'win32'`
- `npm run build` succeeds (TypeScript compiles without errors)
- `grep 'getPlatform' src/platform.ts` shows no console logs or side effects (pure functions)
- File created: `test -f src/platform.ts` returns true
</acceptance_criteria>

**Requirements covered:** FR-1 (platform detection, config dir, shell profiles)

---

### Task P1.2: Update `src/rc.ts` – Socket & Binary (2h)

**Goal:** Replace Windows-only constants with platform-aware functions; add socket cleanup.

<read_first>
- src/rc.ts (current implementation)
- src/platform.ts (after P1.1 completes)
- .planning/phases/01-platform-abstraction/01-RESEARCH.md (lines 88-118)
</read_first>

<action>
1. Add import at top of `src/rc.ts`:
```typescript
import * as platform from './platform';
```

2. Replace constants:
```typescript
// Remove:
// const PIPE_NAME = `\\\\.\\pipe\\claude-remote-${process.pid}`;
// const CLAUDE_BIN = "claude.exe";

// Add:
const PIPE_PATH = platform.getPipePath();
const CLAUDE_BIN = platform.getClaudeBinary();
```

3. Update `startPipeServer()` (around line 120):
```typescript
// Replace pipeServer.listen(PIPE_NAME);
pipeServer.listen(PIPE_PATH);
```

4. Add socket cleanup before listen:
```typescript
if (platform.shouldCleanupSocket()) {
  try { fs.unlinkSync(PIPE_PATH); } catch { /* ignore */ }
}
```

5. Add exit cleanup handler (near top with other process.on):
```typescript
process.on('exit', () => {
  if (platform.shouldCleanupSocket()) {
    try { fs.unlinkSync(PIPE_PATH); } catch {}
  }
});
```

6. Optional but recommended: Verify Claude binary in PATH before spawn:
```typescript
import { which } from 'which';

function verifyClaudeInPath(): string | null {
  try {
    return which.sync(CLAUDE_BIN);
  } catch {
    return null;
  }
}

// In start() before pty.spawn():
const claudePath = verifyClaudeInPath();
if (!claudePath) {
  console.error(`Claude binary '${CLAUDE_BIN}' not found in PATH`);
  if (platform.getPlatform() !== 'win32') {
    console.error('Install Claude Code: curl -fsSL https://claude.ai/install.sh | bash');
  } else {
    console.error('Install Claude Code from https://claude.ai/install');
  }
  process.exit(1);
}
```

7. Ensure all references to `PIPE_NAME` replaced with `PIPE_PATH` (e.g., in `registerPipe()`).

8. Ensure terminal restore `\x1b[?9001l` remains Windows-only (already guarded).

No other changes needed.
</action>

<acceptance_criteria>
- `grep 'import .*platform' src/rc.ts` shows `import * as platform from './platform'`
- `grep 'const PIPE_PATH' src/rc.ts` is present and initialized to `platform.getPipePath()`
- `grep 'const CLAUDE_BIN' src/rc.ts` is present and initialized to `platform.getClaudeBinary()`
- `grep 'shouldCleanupSocket' src/rc.ts` shows cleanup before listen and on exit
- `grep 'pipeServer.listen' src/rc.ts` passes `PIPE_PATH`
- `grep -F "claude.exe" src/rc.ts` returns nothing (hardcoded binary removed)
- `grep -F '\\\\.\\pipe\\' src/rc.ts` appears only if platform.win32 condition (inline function) — should not be top-level constant
- After build and install on Linux, `claude-remote -p "test"` creates `/tmp/claude-remote-<pid>.sock` (check `ls /tmp/claude-remote-*.sock`)
- Socket file removed after exit (check after kill)
- Binary spawns without ENOENT error
</acceptance_criteria>

**Requirements covered:** FR-1 (binary), FR-2 (IPC socket), FR-3 (PTY spawn uses binary)

---

### Task P1.3: Update `src/pipe-client.ts` – Socket Discovery (1.5h)

**Goal:** Make `findPipe()` handle Unix socket files; clean up stale entries.

<read_first>
- src/pipe-client.ts (current implementation)
- src/platform.ts (after P1.1 completes)
- .planning/phases/01-platform-abstraction/01-RESEARCH.md (lines 118-141)
</read_first>

<action>
1. Add import:
```typescript
import * as platform from './platform';
```

2. Update `findPipe()` function:

Current logic reads registry JSON files and checks candidate entries. Modify to include socket file existence check for Linux:

```typescript
function findPipe(): { pipe: string; pid: number } | null {
  const configDir = platform.getConfigDir();
  const registryDir = join(configDir, 'pipe-registry');

  // ... existing code to read .json files and build candidates array ...

  for (const entry of candidates) {
    // On non-Windows, verify socket file exists
    if (platform.shouldCleanupSocket()) {
      try {
        fs.statSync(entry.pipe);
      } catch {
        // Socket file missing — stale entry, skip
        continue;
      }
    }

    // Check if PID still alive
    try {
      process.kill(entry.pid, 0);
      return entry;
    } catch {
      // PID not running — skip
      continue;
    }
  }

  return null;
}
```

3. Ensure `sendPipeMessage()` remains unchanged — `net.createConnection(pipe)` works for both pipe types.

4. Verify timeout is already present (should be) — no change.

5. Optional: Improve error messages when connection fails (distinguish socket vs pipe errors). Not blocking for Phase 1.

No further changes.
</action>

<acceptance_criteria>
- `grep 'import .*platform' src/pipe-client.ts` shows import
- `grep 'shouldCleanupSocket' src/pipe-client.ts` appears in findPipe() around stat check
- After starting daemon on Linux, `claude-remote status` returns successful connection
- If socket file removed but registry exists, findPipe() skips stale entry
- `grep 'net.createConnection' src/pipe-client.ts` does not need changes (already works)
- Unit tests for findPipe() pass if test suite exists (otherwise manual verification)
</acceptance_criteria>

**Requirements covered:** FR-2 (socket discovery)

---

### Task P1.4: Update `src/daemon.ts` – Config Dir & Signals (1h)

**Goal:** Use platform config dir; add SIGPIPE ignore on Linux; ensure env passed correctly.

<read_first>
- src/daemon.ts (current implementation)
- src/platform.ts (after P1.1 completes)
- .planning/phases/01-platform-abstraction/01-RESEARCH.md (lines 141-166)
</read_first>

<action>
1. Add import:
```typescript
import { getConfigDir } from './platform';
```

2. Replace hardcoded config dir:
```typescript
// Remove:
// const CONFIG_DIR = path.join(os.homedir(), '.claude', 'claude-remote');

// Add:
const CONFIG_DIR = getConfigDir();
```

3. Add SIGPIPE ignore at top of file (after imports, before any code):
```typescript
import { getPlatform } from './platform';

if (getPlatform() !== 'win32') {
  process.on('SIGPIPE', () => {}); // Ignore
}
```

4. Verify that daemon receives environment from parent via `fork()` options — existing code at `rc.ts:178-183` passes env; no change needed.

5. Ensure all uses of config dir in daemon.ts use `CONFIG_DIR` constant (already). No other changes.

No need to modify session file paths; they reside under CONFIG_DIR.
</action>

<acceptance_criteria>
- `grep 'import.*getConfigDir' src/daemon.ts` shows import
- `grep 'const CONFIG_DIR = getConfigDir' src/daemon.ts` replaces hardcoded path
- `grep 'process.on .SIGPIPE' src/daemon.ts` appears with condition `getPlatform() !== 'win32'`
- After daemon start on Linux, config dir exists at `~/.claude/claude-remote` (verify `ls ~/.claude/claude-remote`)
- Daemon runs without crashing when socket broken (SIGPIPE ignored)
- `grep -F "~/.claude/claude-remote" src/daemon.ts` should not appear (use CONFIG_DIR variable)
</acceptance_criteria>

**Requirements covered:** FR-1 (config dir), FR-8 (signal handling)

---

### Task P1.5: Update `src/cli.ts` – Setup Wizard for Linux (1h)

**Goal:** Extend `getAliasTargets()` to return Linux shell profiles; ensure install/uninstall work.

<read_first>
- src/cli.ts (current implementation)
- src/platform.ts (after P1.1 completes)
- .planning/phases/01-platform-abstraction/01-RESEARCH.md (lines 167-198)
</read_first>

<action>
1. Add import:
```typescript
import * as platform from './platform';
```

2. Refactor `getAliasTargets()`:

Replace Windows-only logic with conditional:

```typescript
function getAliasTargets(): AliasTarget[] {
  const targets: AliasTarget[] = [];
  const p = platform.getPlatform();
  const ALIAS_MARKER = '# claude-remote alias — do not edit manually';

  if (p === 'win32') {
    // Existing Windows detection (PowerShell 5, PowerShell 7, Git Bash, CMD)
    // ... keep existing code unmodified ...
  } else {
    // Linux/macOS
    const home = os.homedir();

    const shells = [
      { name: 'bash', path: join(home, '.bashrc'), line: `alias claude='claude-remote' ${ALIAS_MARKER}` },
      { name: 'zsh', path: join(home, '.zshrc'), line: `alias claude='claude-remote' ${ALIAS_MARKER}` },
      { name: 'fish', path: join(home, '.config', 'fish', 'config.fish'), line: `function claude; claude-remote $argv; end ${ALIAS_MARKER}` },
    ];

    for (const shell of shells) {
      if (fs.existsSync(shell.path)) {
        targets.push({
          shell: shell.name as 'bash' | 'zsh' | 'fish',
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

Note: Fish syntax uses `function claude; claude-remote $argv; end` — verify from RESEARCH.md line 140.

3. Update `installAlias()` to create parent directories:

```typescript
function installAlias(target: AliasTarget): boolean {
  // Create parent directory if missing (for fish config)
  try {
    fs.mkdirSync(path.dirname(target.profilePath), { recursive: true });
  } catch (err) {
    console.error('Failed to create directory:', target.profilePath, err);
    return false;
  }

  const content = fs.readFileSync(target.profilePath, 'utf-8');
  if (content.includes(target.marker)) {
    return false; // Already installed
  }

  fs.appendFileSync(target.profilePath, `\n${target.aliasLine}\n`);
  return true;
}
```

4. Uninstall logic already removes lines between markers — should work as-is.

5. Ensure `ensureCmdShimInPath()` remains Windows-only. If present, wrap:
```typescript
if (p === 'win32') {
  ensureCmdShimInPath();
}
```
</action>

<acceptance_criteria>
- `grep 'import .*platform' src/cli.ts` shows import
- `grep 'getAliasTargets' src/cli.ts` includes `platform.getPlatform()` condition
- In non-Windows branch, checks for `.bashrc`, `.zshrc`, `fish/config.fish`
- Fish alias line: `function claude; claude-remote $argv; end`
- `installAlias` creates parent directories (grep `mkdirSync.*recursive`)
- On Linux with bash and zsh installed, `claude-remote setup` prints "Detected shells: bash, zsh"
- After setup, `grep 'claude-remote' ~/.bashrc` and `~/.zshrc` show alias lines with marker
- `claude-remote uninstall` removes those lines
- Running install twice does not duplicate (idempotent)
- `grep 'ensureCmdShimInPath' src/cli.ts` is inside `if (platform === 'win32')` or similar guard
</acceptance_criteria>

**Requirements covered:** FR-4 (shell alias installation), UX-2 (discovery messages)

---

### Task P1.6: Update `src/utils.ts` – Platform Constants (0.5h)

**Goal:** Remove hardcoded platform constants; migrate all callers to `platform.ts`.

<read_first>
- src/utils.ts (current)
- src/rc.ts, src/pipe-client.ts, src/daemon.ts, src/cli.ts (to verify imports)
- .planning/phases/01-platform-abstraction/01-RESEARCH.md (lines 199-214)
</read_first>

<action>
1. Open `src/utils.ts`. Identify any constants related to paths, binary names, or platform assumptions. Likely candidates:
   - `CONFIG_DIR`
   - `PIPE_NAME` (should already be moved to rc.ts)
   - Any Windows-only paths

2. If `export const CONFIG_DIR = ...` exists, **remove it entirely**. Replace with platform module.

3. Ensure no other files import `CONFIG_DIR` from `utils.ts`. If they do, they should now import from `platform.ts`. The changes in P1.2, P1.4, etc. already use `platform.getConfigDir()`, so `utils.ts` should no longer export CONFIG_DIR.

4. If `utils.ts` has other platform-agnostic utilities, leave them. Only remove platform-specific constants.

5. After removal, run `grep -r "from './utils'.*CONFIG_DIR" src/` to ensure no leftover references. If found, update those callers to use `platform.getConfigDir()`.

6. If `utils.ts` becomes empty except for non-platform helpers, keep it. Otherwise, delete file if entirely obsolete (unlikely).

In summary, `utils.ts` should not define platform-specific constants; everything defers to `platform.ts`.
</action>

<acceptance_criteria>
- `grep 'CONFIG_DIR' src/utils.ts` returns nothing (or if present, it's not exported or platform-specific)
- `grep "from './utils'.*CONFIG_DIR" src/*.ts` returns no matches
- `grep "from './platform'.*getConfigDir" src/rc.ts src/daemon.ts src/cli.ts src/pipe-client.ts` shows all major files use platform module
- Build succeeds (`npm run build`)
- No remaining hardcoded `~/.claude/claude-remote` strings outside platform.ts (allow string in RESEARCH only)
</acceptance_criteria>

**Requirements covered:** FR-1 (centralized platform functions), Architecture hygiene

---

### Task P1.7 (Optional sanity check): Verify No Windows Regressions

**Goal:** Double-check that Windows-specific code remains functional.

<read_first>
- src/rc.ts, src/cli.ts, src/daemon.ts (after all modifications)
- .planning/phases/01-platform-abstraction/01-RESEARCH.md (lines 30-37)
</read_first>

<action>
Do NOT commit changes without verifying Windows logic preserved. Actions to take:

1. Confirm all platform conditionals:
   - `if (platform.getPlatform() === 'win32')` guards Windows-only code
   - No accidental removal of `\\\\.\\pipe\\` strings (should remain in platform.getPipePath for win32)
   - Terminal restore `\x1b[?9001l` code still present and guarded by win32 check

2. Search for any `process.platform === 'win32'` checks to ensure they still exist in Windows branches.

3. If any Windows-specific function moved to platform.ts, ensure it returns correct values for win32.

4. On Windows (if accessible), test that `claude-remote` still works after changes. This can be done after Phase 1 execution, but during planning we note that testing on Windows must happen before marking phase complete.

No code changes expected — this is a review step.
</action>

<acceptance_criteria>
- `grep 'win32' src/rc.ts src/cli.ts src/daemon.ts src/platform.ts` shows non-zero matches (Windows branches present)
- `grep '\\\\.\\pipe\\' src/platform.ts` appears only inside `if (getPlatform() === 'win32')`
- `grep '\\x1b\\[\\?9001l' src/rc.ts` appears and is inside win32 guard
- No references to Linux-only paths in Windows code branches
- Build succeeds
</acceptance_criteria>

**Requirements covered:** NFR-1 (Windows compatibility), cross-platform integrity

---

## plan-verification

After all tasks complete, verify phase success by running manual integration test on Linux (or WSL2):

1. Build: `npm run build` succeeds.
2. Install globally: `npm install -g --prefix ~/.npm-global .` and add `~/.npm-global/bin` to PATH.
3. Install Claude Code CLI: `curl -fsSL https://claude.ai/install.sh | bash` (if not present).
4. Setup: `claude-remote setup` — configure bot token, guild, category.
5. Verify setup installed alias: `grep claude-remote ~/.bashrc` (or `~/.zshrc`) shows marker.
6. Source shell: `source ~/.bashrc`.
7. Start: `claude-remote -p "hello"` — should spawn PTY and connect to Discord.
8. Check socket: `ls /tmp/claude-remote-*.sock` shows one file.
9. Send message from Discord → appears in Claude.
10. Send message in Claude → appears in Discord.
11. Run `/remote off` and `/remote on` — Discord posts status changes.
12. Run `/stop` and `/clear` — work as expected.
13. Kill parent (`pkill -f claude-remote`) → daemon exits, socket removed.
14. Run `claude-remote uninstall` — removes alias, hooks, config dir.

Additionally, run a quick Windows sanity check (if Windows environment available):
- Build on Windows (or build cross-platform but run on Windows)
- `claude-remote -p "test"` spawns Claude with Windows terminal, no errors about named pipes
- Discord connectivity works

**Success criteria (Nyquist dimensions):**

- **Dimension 2 (Frontmatter):** PLAN.md has all required fields (wave, depends_on, files_modified, autonomous, requirements).
- **Dimension 4 (Deep work):** Every task has `<read_first>`, `<action>` with concrete values, `<acceptance_criteria>` with verifiable greps.
- **Dimension 6 (Verification):** Plan includes acceptance criteria per task and a post-plan verification checklist.
- **Dimension 8 (Validation architecture):** Phase 1 requires manual integration testing; verification strategy is documented in RESEARCH.md (Verification Criteria sections) and reinforced in plan-verification above. Automated unit tests for platform.ts are optional.
- **Dimension 9 (Goal-backward):** `must_haves` listed below directly map to phase goal.

**must_haves (critical for phase completion):**

- [ ] `src/platform.ts` created with all six functions
- [ ] `rc.ts` uses `platform.getPipePath()` and `platform.getClaudeBinary()`
- [ ] Unix socket created at `/tmp/claude-remote-<pid>.sock` on Linux (Windows pipe unchanged)
- [ ] Socket cleanup on exit (no stale `.sock` files)
- [ ] `pipe-client.ts` handles socket file existence in `findPipe()`
- [ ] `daemon.ts` uses `platform.getConfigDir()` and sets `SIGPIPE` ignore on Linux
- [ ] `cli.ts` installs bash/zsh/fish aliases correctly with idempotency
- [ ] `utils.ts` no longer exports platform-specific constants (CONFIG_DIR removed)
- [ ] All acceptance criteria tasks pass on Linux test
- [ ] No regression on Windows (build still works, pipes still functional)

**Documentation updates required:**

- README.md updates are Phase 4 tasks; not required for Phase 1 completion. But note that Linux installation instructions should be drafted early for testing.

---

**End of PLAN.md**
