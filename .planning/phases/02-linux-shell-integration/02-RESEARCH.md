# Phase 2 Research: Linux Shell Integration Polish

**Phase**: 02 — Linux Shell Integration Polish
**Date**: 2026-03-21
**Researcher**: Manual synthesis (agent unavailable)
**Status**: Complete

---

## Phase Goal Refresher

Ensure setup works smoothly across diverse Linux environments. Improve shell detection, add PATH verification, support .env file for credentials, and optionally add systemd integration.

---

## Current State Analysis

### Existing Implementation (cli.ts:217-283)

Current `getAliasTargets()` already does:
- Linux detection via `platform.getPlatform()`
- Checks existence of `.bashrc`, `.zshrc`, `fish/config.fish`
- Creates parent directories on install
- Idempotent marker-based installation

**Shell detection strategy:** File existence checks only. Does not use `$SHELL` env var. Does NOT check:
- `~/.profile` (login shells)
- `~/.bash_profile` (bash login)
- `~/.zprofile` (zsh login)

**Multiple shell handling:** Installs to ALL detected shells automatically (line 270-279). No user prompt to select.

---

## Technical Research Findings

### 1. Shell Detection Best Practices

**The problem:** Linux users may have multiple shell config files. Installing to all can cause:
- Duplicate aliases if both `.bashrc` and `.profile` source each other
- Unexpected behavior if different shells have different alias definitions
- Pollution of config files user didn't intend to modify

**Solution:** Use `$SHELL` environment variable as primary indicator, plus file existence as fallback. Document strategy clearly.

**Implementation approach:**

```typescript
function detectShells(): Array<{ name: string; path: string; line: string; desc: string }> {
  const home = os.homedir();
  const SHELL = process.env.SHELL || '';
  const detected = new Set<string>();

  // Primary: use $SHELL to determine user's default shell
  if (SHELL.includes('bash')) detected.add('bash');
  else if (SHELL.includes('zsh')) detected.add('zsh');
  else if (SHELL.includes('fish')) detected.add('fish');

  // Fallback: check common config file existence
  const fileMap: Array<{ name: string; path: string }> = [
    { name: 'bash', path: path.join(home, '.bashrc') },
    { name: 'zsh', path: path.join(home, '.zshrc') },
    { name: 'fish', path: path.join(home, '.config', 'fish', 'config.fish') },
  ];

  for (const shell of fileMap) {
    if (fs.existsSync(shell.path) && !detected.has(shell.name)) {
      detected.add(shell.name);
    }
  }

  return Array.from(detected).map(name => {
    const entry = fileMap.find(f => f.name === name)!;
    return {
      name,
      path: entry.path,
      line: name === 'fish'
        ? `function claude; claude-remote $argv; end ${ALIAS_MARKER}`
        : `alias claude='claude-remote' ${ALIAS_MARKER}`,
      desc: name === 'bash' ? 'Bash' : name === 'zsh' ? 'Zsh' : 'Fish'
    };
  });
}
```

**Login vs interactive shells:** Note that `.profile` is sourced by login shells; `.bashrc` by interactive non-login. Many distros source `.bashrc` from `.profile`. To avoid double-install, prefer `.bashrc` and skip `.profile` if `.bashrc` exists. For zsh, prefer `.zshrc` over `.zprofile`. Document this decision.

**User choice:** If multiple shells detected, ask user:
```
Detected shells: bash, zsh
Install alias to:
  [ ] Both (default)
  [ ] bash only
  [ ] zsh only
  [ ] Skip
```

Implementation: Use `p.confirm()` or `p.multiselect()` before running install tasks.

---

### 2. PATH Verification for Claude Binary

**Problem:** User may have Claude installed but not in PATH when running `claude-remote`. Current code in `rc.ts` uses `which` to verify binary before spawn (good), but error message could be more actionable.

**Research on `which` npm package:**
- Package: `which` (already in dependencies? Check package.json)
- Usage: `which.sync('claude')` returns full path or throws
- Cross-platform: uses `where` on Windows, `which` on Unix

**Improved error message:**

```typescript
function verifyClaudeInPath(): string | null {
  const bin = platform.getClaudeBinary();
  try {
    return which.sync(bin, { nothrow: true }) || null;
  } catch {
    return null;
  }
}

// In start() before pty.spawn():
const claudePath = verifyClaudeInPath();
if (!claudePath) {
  console.error(`\x1b[31mError:\x1b[0m Claude binary '${CLAUDE_BIN}' not found in PATH.`);
  console.error('');
  console.error('Install Claude Code CLI:');
  console.error('  curl -fsSL https://claude.ai/install.sh | bash');
  console.error('');
  console.error('Or ensure the directory containing claude is in your PATH:');
  console.error(`  export PATH="\$HOME/.local/bin:\$PATH"   # common install location`);
  console.error('');
  process.exit(1);
}
```

**Alternative approach:** Instead of hardcoding path guidance, suggest running `which claude` to diagnose. But the install script URL is most helpful.

---

### 3. .env File Support for Environment Variables

**Problem:** Users may set `DISCORD_*` in `~/.profile` but these aren't loaded for non-login shells. Also, environment variables are visible in process list if exported.

**Solution:** Support `~/.config/claude-remote/.env` file loaded via `dotenv` package.

**Implementation:**

1. Install `dotenv` as dependency: `npm install dotenv`
2. In `rc.ts` before spawning daemon, load `.env`:

```typescript
import dotenv from 'dotenv';
import { join } from 'node:path';
import { platform } from './platform.js';

const CONFIG_DIR = platform.getConfigDir();
dotenv.config({ path: join(CONFIG_DIR, '.env') });
```

3. Document in README and setup wizard output:
   - After setup completes, show message: "You can also store your Discord credentials in ~/.config/claude-remote/.env instead of setting environment variables."

**Security:** `.env` file should be user-readable only (600). Create with `fs.writeFileSync(path, content, { mode: 0o600 })`. Document this.

**Order of precedence:** Environment variables override `.env` (dotenv default). This is fine.

**.gitignore:** Already have `*.env` in `.gitignore`? Check. If not, add.

---

### 4. systemd --user Service (Optional/Stretch)

**Decision from roadmap:** "May defer to post-v2.0 release. Keep as stretch goal."

**Research:** How to implement optional systemd service installation.

**Implementation sketch:**

During `setup()`:
```typescript
if (platform.getPlatform() !== 'win32') {
  const enableSystemd = await p.confirm({
    message: 'Install systemd --user service for auto-start on login? (optional)',
    initialValue: false,
  });

  if (enableSystemd) {
    // Write unit file
    const unitDir = path.join(home, '.config', 'systemd', 'user');
    const unitPath = path.join(unitDir, 'claude-remote.service');
    const unitContent = `[Unit]
Description=Claude Remote Daemon
After=network.target

[Service]
Type=simple
EnvironmentFile=${CONFIG_DIR}/.env
ExecStart=${process.execPath} --working-directory "${cwd}" // or just claude-remote
Restart=on-failure
RestartSec=10

[Install]
WantedBy=default.target
`;
    fs.mkdirSync(unitDir, { recursive: true });
    fs.writeFileSync(unitPath, unitContent, { mode: 0o644 });

    // Enable and start
    execSync('systemctl --user enable claude-remote.service', { stdio: 'ignore' });
    execSync('systemctl --user start claude-remote.service', { stdio: 'ignore' });

    p.log.info('Systemd service installed and started');
  }
}
```

**Uninstall:** Remove unit file and disable:
```typescript
execSync('systemctl --user disable claude-remote.service', { stdio: 'ignore' });
fs.unlinkSync(unitPath);
```

**Considerations:**
- Requires user to have systemd --user enabled (most modern distros have)
- Needs `systemctl` in PATH
- Service runs as user, not root
- EnvironmentFile points to `.env` if exists

**Recommended:** Implement as stretch for Phase 2 if time permits; otherwise defer to Phase 3 or post-v2.0. Phase 2 focus should be on core polish (shell detection, PATH, .env). systemd can be separate PR.

---

## Open Questions & Decisions Needed

1. **Should we support `.profile` and `.bash_profile`?**
   - Risk: double installation if user's `.bashrc` already sourced from `.profile`
   - Decision: **Only install to `.bashrc` and `.zshrc`** (interactive shells). Document that login shells should source these. Simpler and safer.
   - Exception: If `.bashrc` doesn't exist but `.profile` does, install to `.profile` as fallback.

2. **User selection for multiple shells:**
   - Should we prompt? Current behavior (install to all) is convenient but may surprise users who only use one shell.
   - Decision: **Prompt if more than one shell detected** using `p.multiselect()` with defaults = all detected. Allows fine-grained control.

3. **systemd integration:**
   - Stretch goal; complexity vs value tradeoff
   - Decision: **Defer to Phase 3** (Testing & Polish) or post-v2.0. Phase 2 should finish core polish tasks first.

---

## Validation Architecture

**Nyquist Dimension 8 Requirement:** Plans must include validation criteria that prove phase goal achieved.

**Phase 2 Goal:** "Ensure setup works smoothly across diverse Linux environments."

**Validation approach:**

### Acceptance Criteria per Task (to be included in PLAN.md)

- **P2.1 (Shell Profiling):**
  - `grep '\$SHELL' src/cli.ts` shows env var usage in detection
  - `grep '\.profile' src/cli.ts` appears but `.bashrc` preferred
  - `p.multiselect` prompt present in setup flow (verify via code inspection)
  - Manual test: `SHELL=/bin/bash claude-remote setup` → targets bash even if zsh files exist

- **P2.2 (PATH Verification):**
  - `grep 'which' src/rc.ts` shows import and usage
  - Error message contains "Claude binary 'claude' not found in PATH" and install URL
  - Manual test: rename `claude` binary → `claude-remote` prints error and exits code 1

- **P2.3 (.env Support):**
  - `grep 'dotenv' src/rc.ts` or `src/cli.ts` shows import and `config()` call
  - `.env` file loaded from `~/.config/claude-remote/.env`
  - Manual test: create `.env` with tokens, unset env vars → daemon starts successfully

- **P2.4 (systemd optional):**
  - If implemented: unit file written to `~/.config/systemd/user/claude-remote.service`
  - `systemctl --user enable/start` called during setup
  - Manual test: `systemctl --user status claude-remote` shows active after boot

### Integration Test Checklist

Run on Linux (Ubuntu/Fedora/WSL2):

1. [ ] `claude-remote setup` completes without errors
2. [ ] Shell detection: prints "Detected shells: ..." based on `$SHELL` and files
3. [ ] If multiple shells: prompt allows selection
4. [ ] Aliases install to selected profiles only (not all)
5. [ ] `which claude` check: if missing, clear error shown
6. [ ] `.env` file loading works (no need to export DISCORD_*)
7. [ ] systemd service (if enabled) starts on boot (test with `systemctl --user enable` then reboot)

### Success Criteria (Phase-level)

- ✅ User receives clear guidance when Claude not in PATH
- ✅ Setup respects user's shell choice, doesn't pollute unrelated config files
- ✅ Credentials can be stored in `.env` file for convenience
- ✅ No regressions in Phase 1 functionality

---

## Implementation Plan (Synthesized for Planner)

### Task P2.1: Enhanced Shell Profiling

**Changes:**
- Detect default shell from `$SHELL`
- Check additional files: `~/.profile` (fallback), `~/.bash_profile` (rare), `~/.zprofile` (zsh login)
- Prefer `.bashrc` over `.profile`, `.zshrc` over `.zprofile`
- Prompt user if multiple shells detected using `p.multiselect()` with defaults = all detected.

**Files to modify:** `src/cli.ts` — `getAliasTargets()` and `setup()` flow.

**Acceptance:**
- `$SHELL` is read and used as primary signal
- File existence checks supplement
- If `.bashrc` absent but `.profile` present, fallback to `.profile`
- User prompt appears when >1 shell detected, with sensible defaults
- Idempotency preserved (marker check)
- Uninstall still removes from all previously installed profiles

---

### Task P2.2: PATH Verification

**Changes:**
- In `rc.ts`, before `pty.spawn()`, use `which.sync(CLAUDE_BIN)` to locate binary
- If not found, print clear error with install instructions and PATH guidance
- Exit with code 1

**Dependencies:** `which` package (verify in package.json; add if missing).

**Files to modify:** `src/rc.ts` — add `import which from 'which'` and verification function before spawn.

**Acceptance:**
- `claude` not in PATH → error message displays with helpful instructions
- `claude` in PATH → proceeds normally
- No false negatives

---

### Task P2.3: .env File Support

**Changes:**
- Ensure `dotenv` is dependency (`npm install dotenv`)
- In `rc.ts` at top (after imports), load `.env` from config dir
- Document in README and setup output
- Optionally create `.env.example` during setup

**Files to modify:**
- `rc.ts` (add dotenv config at top)
- Optionally `cli.ts` to create example file

**Acceptance:**
- Create `~/.config/claude-remote/.env` with tokens
- Unset env vars → daemon starts successfully
- `.env` ignored by git
- Env vars override .env (dotenv default)

---

### Task P2.4 (Stretch): systemd --user Service

**Defer decision:** Mark as stretch. Implement only if time permits or move to Phase 3.

**If implemented:**
- Add to `setup()` after alias installation
- Prompt for installation
- Write unit file to `~/.config/systemd/user/claude-remote.service`
- Enable and start service
- Uninstall removes unit file and disables

---

## Risks & Mitigations

| Risk | Severity | Mitigation |
|------|----------|------------|
| Shell detection logic picks wrong shell | Medium | Use `$SHELL` as primary; fallback to file existence; document assumptions |
| Duplicate aliases from multiple file installs | Medium | Prefer interactive shell files; skip login files if interactive exists; marker-based removal handles duplicates |
| `which` not available on minimal systems | Low | Use `which.sync` from npm package (bundled), not shell command |
| `.env` file permissions too open | Medium | Create with `mode: 0o600`; warn in docs |
| systemd unit file path differs per distro | Low | Use XDG config: `~/.config/systemd/user/` — standard location |

---

## Conclusion

Phase 2 improvements are **straightforward polish** on top of Phase 1's platform abstraction. Core tasks:
1. Refine shell detection using `$SHELL` + smart file choice + user prompt
2. Add PATH check with helpful error
3. Add `.env` file support via `dotenv`
4. Optionally add systemd integration

No major architectural changes needed. All changes localized to `cli.ts` and `rc.ts`. Research phase complete — ready for planning.

---
**End of RESEARCH.md**
