---
title: Linux Shell Integration Polish
description: Phase 2: Polish setup wizard for diverse Linux environments (shell detection, PATH check, .env support, optional systemd)
wave: 1
depends_on: []
files_modified:
  - src/cli.ts
  - src/rc.ts
autonomous: false
requirements:
  - FR-1
  - FR-4
  - UX-2
  - UX-3
  - FR-5
---

# Phase 2: Linux Shell Integration Polish — Detailed Plan

**Total estimated effort:** 4.5 hours (3 main tasks + optional stretch)
**Wave structure:** Single wave (tasks independent after any shared foundation)
**Dependencies:** P2.2 and P2.3 independent; both can run after P2.1 (no real dependencies but logical grouping)

---

## Task P2.1: Enhanced Shell Profiling

**Goal:** Improve shell detection logic to use `$SHELL`, prefer interactive shell configs, and prompt user if multiple shells detected.

<read_first>
- src/cli.ts (current implementation of `getAliasTargets()` and `setup()`)
- .planning/phases/02-linux-shell-integration/02-RESEARCH.md (implementation guidance)
</read_first>

<action>
1. In `src/cli.ts`, refactor `getAliasTargets()`:

   - Read `process.env.SHELL` to determine user's default shell.
   - Create `detectedShells = new Set<string>()`.
   - If `SHELL` contains 'bash' → add 'bash'; 'zsh' → 'zsh'; 'fish' → 'fish'.
   - As fallback, check existence of config files: `.bashrc`, `.zshrc`, `fish/config.fish`. Add to set if file exists and not already present.
   - Build `targets` array from `detectedShells`, mapping each to:
     - `shell` type: 'bash' | 'zsh' | 'fish'
     - `profilePath`: `~/.bashrc`, `~/.zshrc`, or `~/.config/fish/config.fish`
     - `aliasLine`: For bash/zsh: `alias claude='claude-remote' # claude-remote alias — do not edit manually`; for fish: `function claude; claude-remote $argv; end # claude-remote alias — do not edit manually`
     - `description`: 'Bash', 'Zsh', or 'Fish'
   - **Important:** Only add bash if `.bashrc` exists; if not, fallback to `.profile` ONLY if `.bashrc` missing. Similarly for zsh: prefer `.zshrc`, fallback to `.zprofile` if `.zshrc` missing. Document this fallback in code comments.

2. Modify `setup()` flow (around line 514-537):

   - After `const targets = getAliasTargets();`, check `targets.length`.
   - If `targets.length > 1`, prompt user to select which shells to install to:
     ```typescript
     const selected = await p.multiselect({
       message: 'Install claude alias to:',
       options: targets.map(t => ({ value: t.shell, label: `${t.description} (${t.profilePath})` })),
       initialValue: targets.map(t => t.shell), // all selected by default
     });
     if (p.isCancel(selected)) { /* handle cancel */ }
     // Filter targets to only selected shells
     const chosenTargets = targets.filter(t => selected.includes(t.shell));
     ```
   - If `targets.length === 1`, proceed without prompt (install to the detected shell).
   - If `targets.length === 0`, show warning: "No shell profiles found. Please install manually or create ~/.bashrc, ~/.zshrc, or fish config."

3. Pass `chosenTargets` (or `targets` if no prompt) to the install tasks.

4. Update `uninstall()` to use the same `getAliasTargets()` logic (unchanged — uninstall should remove from all shells that would be targeted by install). This ensures idempotency.

5. Ensure `installAlias()` and `uninstallAlias()` remain unchanged (they already handle marker-based idempotency and removal).

No other changes.

**Acceptance criteria:**
- `grep 'process.env.SHELL' src/cli.ts` appears in `getAliasTargets()` or helper
- `grep '\.profile' src/cli.ts` appears but `.bashrc` is used if both exist (verify logic: if `.bashrc` exists, `.profile` not added to targets)
- `grep 'p.multiselect' src/cli.ts` shows prompt when `targets.length > 1`
- Manual test: with both `.bashrc` and `.zshrc` present and `SHELL=/bin/bash` → prompt shows both with bash pre-checked; user can uncheck zsh
- Manual test: with only `.profile` (no `.bashrc`) → installs to `.profile`
- Idempotency preserved: running `setup` twice does not duplicate alias lines
- Uninstall removes marker lines from all targeted profile files

---

## Task P2.2: PATH Verification

**Goal:** Add early binary verification with clear, actionable error messages when `claude` not in PATH.

<read_first>
- src/rc.ts (current binary spawn logic)
- .planning/phases/02-linux-shell-integration/02-RESEARCH.md (error message guidance)
</read_first>

<action>
1. Ensure `which` is in dependencies: check `package.json` for `"which"`. If missing, add it (but this plan only modifies `src/rc.ts`; assume dependency already present from previous research). For executor: if missing, `npm install which` should be run before tests.

2. In `src/rc.ts`, at top add import:
   ```typescript
   import which from 'which';
   ```

3. Add helper function near top (after imports):
   ```typescript
   function verifyClaudeInPath(): string | null {
     try {
       return which.sync(platform.getClaudeBinary(), { nothrow: true });
     } catch {
       return null;
     }
   }
   ```

4. In `start()` method, before `const proc = pty.spawn(...)`, add:
   ```typescript
   const claudePath = verifyClaudeInPath();
   if (!claudePath) {
     console.error('');
     console.error('\x1b[31m✖ Error:\x1b[0m Claude binary not found in PATH.');
     console.error('');
     console.error('Install Claude Code CLI:');
     console.error('  curl -fsSL https://claude.ai/install.sh | bash');
     console.error('');
     console.error('Or ensure the directory containing claude is in your PATH:');
     console.error('  export PATH="$HOME/.local/bin:$PATH"   # common install location');
     console.error('');
     process.exit(1);
   }
   ```

   (Use `\x1b[31m` for red color if desired, consistent with other error output.)

5. Ensure this check runs before any PTY spawn attempt.

**Acceptance criteria:**
- `grep 'import which' src/rc.ts` present
- `grep 'verifyClaudeInPath' src/rc.ts` shows function definition and call before `pty.spawn`
- Manual test: temporarily rename `claude` binary or adjust PATH to exclude its location → running `claude-remote -p "test"` prints the error block with install URL and exits with code 1
- Manual test: restore `claude` in PATH → `claude-remote` starts normally without error
- Error message includes three lines: "Install Claude Code CLI", "Or ensure...", and shows correct PATH example

---

## Task P2.3: .env File Support

**Goal:** Load environment variables from `~/.config/claude-remote/.env` to simplify configuration.

<read_first>
- src/rc.ts (current environment handling)
- src/cli.ts (where dotenv could be loaded)
- .planning/phases/02-linux-shell-integration/02-RESEARCH.md (dotenv integration details)
</read_first>

<action>
1. Add `dotenv` dependency if not present: `npm install dotenv` (outside code changes, but executor should ensure).

2. In `src/rc.ts`, at very top (after imports, before any config access), add:
   ```typescript
   import dotenv from 'dotenv';
   import { join } from 'node:path';
   import { platform as platformModule } from './platform.js';

   const CONFIG_DIR = platformModule.getConfigDir();
   dotenv.config({ path: join(CONFIG_DIR, '.env') });
   ```

   Note: `platform` is already imported as `* as platform` from './platform.js' in rc.ts. Use that:
   ```typescript
   dotenv.config({ path: join(platform.getConfigDir(), '.env') });
   ```

3. No other code changes needed — environment variables become available in `process.env` automatically, and daemon reads them from there.

4. Optional but recommended: During `setup()` in `cli.ts`, after saving config, create a sample `.env.example` file in config dir to guide users:
   ```typescript
   const examplePath = path.join(CONFIG_DIR, '.env.example');
   if (!fs.existsSync(examplePath)) {
     fs.writeFileSync(examplePath, `DISCORD_BOT_TOKEN=your_token_here\nDISCORD_GUILD_ID=your_guild_id\nDISCORD_CATEGORY_ID=your_category_id\n`);
   }
   ```
   This is non-blocking and can be added if desired. For minimal plan, skip.

**Acceptance criteria:**
- `grep 'dotenv' src/rc.ts` shows import and `config()` call at top
- `grep '\.env' src/rc.ts` shows path constructed with `platform.getConfigDir()`
- Manual test: create `~/.config/claude-remote/.env` with valid tokens
- Unset `DISCORD_BOT_TOKEN`, `DISCORD_GUILD_ID`, `DISCORD_CATEGORY_ID` from shell environment
- Run `claude-remote -p "test"` → daemon starts and connects (no "Missing environment variable" errors)
- Verify that exported env vars still override .env file values (dotenv default behavior)

---

## Task P2.4 (Stretch): systemd --user Service (Optional)

**Goal:** Provide optional systemd unit for auto-start on login.

<read_first>
- .planning/phases/02-linux-shell-integration/02-RESEARCH.md (systemd implementation sketch)
- src/cli.ts (setup wizard)
</read_first>

<action>
**Note:** This task is optional/stretch. If not implemented in Phase 2, defer to Phase 3.

If implementing:

1. In `src/cli.ts`, modify `setup()` function after alias installation (around line 537):

   Add conditional block:
   ```typescript
   if (platform.getPlatform() !== 'win32') {
     const enableSystemd = await p.confirm({
       message: 'Install systemd --user service for auto-start on login? (optional)',
       initialValue: false,
     });

     if (enableSystemd) {
       const home = os.homedir();
       const unitDir = path.join(home, '.config', 'systemd', 'user');
       const unitPath = path.join(unitDir, 'claude-remote.service');
       const execPath = process.argv[0]; // Path to node or claude-remote binary?
       // Better: use the claude-remote command that would be in PATH
       // For simplicity, assume claude-remote is in PATH and just run 'claude-remote'
       const unitContent = `[Unit]
Description=Claude Remote Daemon
After=network.target

[Service]
Type=simple
EnvironmentFile=${CONFIG_DIR}/.env
ExecStart=claude-remote
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

2. In `uninstall()` (`src/cli.ts`), add cleanup for systemd:
   ```typescript
   if (platform.getPlatform() !== 'win32') {
     try {
       execSync('systemctl --user disable claude-remote.service', { stdio: 'ignore' });
       const unitPath = path.join(home, '.config', 'systemd', 'user', 'claude-remote.service');
       if (fs.existsSync(unitPath)) fs.unlinkSync(unitPath);
     } catch { /* best effort */ }
   }
   ```

3. Document in README (Phase 4) but can mention in setup output.

**Acceptance criteria:**
- `grep 'systemctl --user enable' src/cli.ts` appears in systemd block
- `grep 'systemd' src/cli.ts` shows unit file path and content template
- Manual test on Linux with systemd --user:
  - Run `claude-remote setup`, enable systemd option
  - Verify `~/.config/systemd/user/claude-remote.service` exists with correct `EnvironmentFile` and `ExecStart`
  - Run `systemctl --user status claude-remote` shows active
  - Reboot machine (or `systemctl --user daemon-reload && systemctl --user restart claude-remote`) → service starts automatically
  - Run `claude-remote uninstall` → unit file removed and service disabled

**If not implemented:** Leave this task incomplete; Phase 2 complete without it.

---

## Plan Verification

After all tasks complete, verify Phase 2 success by running manual integration test on Linux:

1. Build: `npm run build` succeeds.
2. Install: `npm install -g --prefix ~/.npm-global .` and add to PATH.
3. Run `claude-remote setup`:
   - Observe shell detection: prints detected shells based on `$SHELL` and files
   - If both bash and zsh present, multiselect prompt appears
   - Choose subset → only those profiles modified
4. After setup, check `~/.bashrc` or chosen profile → alias line present with marker.
5. Test PATH verification: temporarily break `which claude` → `claude-remote` prints helpful error and exits.
6. Test `.env`: create config with tokens, unset env vars, run `claude-remote -p "test"` → connects.
7. Optional: systemd service → check `systemctl --user status` if implemented.
8. Run `claude-remote uninstall` → all modifications removed.

**Success criteria (Nyquist dimensions):**

- **Dimension 2:** PLAN.md has frontmatter with wave, depends_on, files_modified, autonomous, requirements.
- **Dimension 4:** Every task has `<read_first>` and `<action>` with concrete values (no vague directions).
- **Dimension 6:** Every task has `<acceptance_criteria>` with verifiable greps and manual checks.
- **Dimension 8:** Validation strategy documented in VALIDATION.md with per-task manual verification steps and integration checklist.
- **Dimension 9:** `must_haves` below directly map to phase goal.

---

## must_haves (critical for phase completion)

- [ ] Shell detection uses `$SHELL` as primary signal, file existence as fallback
- [ ] `.bashrc` preferred over `.profile`, `.zshrc` over `.zprofile`
- [ ] User prompt (multiselect) when multiple shells detected
- [ ] PATH check with `which.sync()` before `pty.spawn`
- [ ] Clear error message with install URL when `claude` missing
- [ ] `dotenv.config()` loads `~/.config/claude-remote/.env`
- [ ] Environment variables from .env available to daemon without explicit export
- [ ] All acceptance criteria tasks pass manual verification
- [ ] No regressions in Phase 1 functionality (build, setup, IPC, alias install/uninstall)
- [ ] (Optional) systemd service integrates correctly if implemented

---

**End of PLAN.md**
