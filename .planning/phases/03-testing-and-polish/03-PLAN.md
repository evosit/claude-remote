---
title: Phase 3: Testing & Polish — Linux Cross-Distro Validation
description: Phase 3 tasks: multi-distro test infrastructure, proactive robustness improvements, and debug logging integration.
wave: 1
depends_on: []
files_modified:
  - .planning/phases/03-testing-and-polish/TESTING.md
  - .github/workflows/test.yml
  - package.json
  - src/rc.ts
  - src/pipe-client.ts
  - src/daemon.ts
  - src/platform.ts
  - README.md
autonomous: false
requirements: []
---

## Phase 3: Testing & Polish — Detailed Plan

**Total estimated effort:** 6-8 hours (11 tasks)
**Wave structure:** Single wave (tasks independent or build on each other logically)
**Dependencies:** Task order matters; P3.1 precedes P3.2-P3.4; P3.5 depends on P3.4 (report exists); P3.6-P3.9 independent.

### Task P3.1: Define Multi-Distro Test Matrix (1.5h)

**Goal:** Create TESTING.md that documents test procedures for Ubuntu 22.04, Fedora, Alpine, and WSL2.

<read_first>
- .planning/ROADMAP.md (Phase 3 tasks)
- .planning/STATE.md (project context)
- src/rc.ts (entry point)
- src/cli.ts (setup command)
</read_first>

<action>
1. Create `.planning/phases/03-testing-and-polish/TESTING.md` with the following sections:
   - **Introduction**: Purpose of testing, target distributions, success criteria.
   - **Test Matrix** table:
     | Distro | Build | Install | Basic -p | Setup Wizard | Uninstall | Notes |
     |--------|-------|---------|----------|--------------|-----------|-------|
     | Ubuntu 22.04 | ✅ | ✅ | ✅ | ✅ | ✅ | Primary target |
     | Fedora (latest) | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | Need test |
     | Alpine 3.19+ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | May require build dependencies |
     | WSL2 (Ubuntu) | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | File watching quirks possible |
   - **Prerequisites** per distro:
     - Node.js 18+ (use nvm or distro package)
     - Build tools: `build-essential` (Ubuntu/Debian), `dnf groupinstall "Development Tools"` (Fedora), `apk add build-base python3` (Alpine)
     - Git, curl
     - Claude Code CLI install command: `curl -fsSL https://claude.ai/install.sh | bash`
   - **Installation Steps**:
     1. Clone repo or download source
     2. `npm ci`
     3. `npm run build`
     4. `npm install -g --prefix ~/.npm-global .` and add `~/.npm-global/bin` to PATH (or use sudo)
     5. Verify: `claude-remote --version`
   - **Test Cases**:
     - **TC1: Help output** → `claude-remote help` exits 0, shows usage
     - **TC2: Setup wizard** → run `claude-remote setup`, provide bot token (use test token), select guild, complete. Verify alias installation message.
     - **TC3: Basic session** → `claude-remote -p "hello"` should start, connect to Discord, send message, wait for response (manual verification), exit cleanly. (Non-interactive version: start with a short-lived prompt).
     - **TC4: Status toggle** → inside a session, type `/remote off` and `/remote on`; Discord should see status messages.
     - **TC5: Uninstall** → `claude-remote uninstall` removes config and aliases.
   - **Expected Observations**:
     - Socket file created at `/tmp/claude-remote-<pid>.sock` (Linux/macOS)
     - Daemon logs to `~/.claude/claude-remote/daemon.log`
     - No uncaught exceptions or crashes
   - **Reporting**: Capture terminal output, exit codes, and any error messages. Fill matrix table with ✅/⬜ and notes.
   - **WSL2 Notes**: Document any file watching delays or inotify issues; may need to adjust chokidar options.
2. Commit file with message: "test(phase-03): add TESTING.md with multi-distro test matrix".
</action>

<acceptance_criteria>
- `test -f .planning/phases/03-testing-and-polish/TESTING.md`
- `grep -q "Ubuntu 22.04" TESTING.md`
- `grep -q "Fedora" TESTING.md`
- `grep -q "Alpine" TESTING.md`
- `grep -q "WSL2" TESTING.md`
- `grep -q "claude-remote --version" TESTING.md`
- `grep -q "Test Cases" TESTING.md`
- File is committed to git
</acceptance_criteria>

**Requirements covered:** P3.1 (test matrix)

---

### Task P3.2: Add GitHub Actions CI for Ubuntu (1.5h)

**Goal:** Set up automated smoke tests on Ubuntu via GitHub Actions to catch basic build/runtime regressions.

<read_first>
- .github/workflows/publish.yml (existing workflow pattern)
- package.json (scripts section)
- TESTING.md (test cases)
</read_first>

<action>
1. Create `.github/workflows/test.yml`:
```yaml
name: Multi-Distro Tests

on:
  push:
    branches: [main, master]
  pull_request:

jobs:
  test-ubuntu:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: "22"

      - name: Install system dependencies
        run: |
          sudo apt-get update
          sudo apt-get install -y build-essential python3

      - name: Install Claude Code CLI (mock)
        run: |
          # In CI we cannot actually install Claude (requires curl to external).
          # Instead, we'll create a mock `claude` script that simulates basic behavior.
          echo -e '#!/bin/bash\necho "Mock Claude: $@"' > /tmp/claude
          chmod +x /tmp/claude
          echo 'export PATH="/tmp:$PATH"' >> $GITHUB_ENV

      - name: Install dependencies
        run: npm ci

      - name: Build
        run: npm run build

      - name: Smoke tests
        run: |
          claude-remote --version
          claude-remote help

      - name: Upload logs
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: test-ubuntu-logs
          path: |
            ~/.claude-claude-remote/
            /tmp/claude-remote-*.sock
```

2. Add a `test:smoke` script to `package.json`:
```json
{
  "scripts": {
    "test:smoke": "claude-remote --version && claude-remote help"
  }
}
```
Ensure this script is added to the existing `"scripts"` block, preserving other scripts.

3. Commit both files with message: "test(phase-03): add GitHub Actions CI and smoke test script".
</action>

<acceptance_criteria>
- `test -f .github/workflows/test.yml`
- `grep -q "test-ubuntu" .github/workflows/test.yml`
- `grep -q "npm ci" .github/workflows/test.yml`
- `grep -q "test:smoke" package.json`
- Running `npm run test:smoke` locally exits with code 0 and prints version then help
- Workflow file is valid YAML (`python -c "import yaml; yaml.safe_load(open('.github/workflows/test.yml'))"` returns no error if yaml installed)
- Files committed
</acceptance_criteria>

**Requirements covered:** P3.1 (CI for Ubuntu)

---

### Task P3.3: Manual WSL2 Testing Checklist (1h)

**Goal:** Provide structured checklist for testing on WSL2 where CI cannot emulate.

<read_first>
- TESTING.md (overall test matrix)
- .planning/phases/03-testing-and-polish/ (existing files)
</read_first>

<action>
1. Create `.planning/phases/03-testing-and-polish/WSL2-CHECKLIST.md` with:
   - Prerequisites specific to WSL2: ensure Node.js installed, Claude Code CLI installed, Windows host has Discord access.
   - Additional focus areas:
     - File watching: verify JSONL changes detected when editing files from Windows editor (via /mnt/c/...) vs Linux-side editor.
     - Terminal behavior: PTY rendering, colors, Unicode.
     - Socket cleanup: after exiting WSL2, `/tmp/claude-remote-*.sock` cleaned by WSL shutdown.
   - Step-by-step manual test procedure mirroring TESTING.md test cases but with WSL2 notes.
   - A results table to fill.
2. Commit file with message: "test(phase-03): add WSL2 manual testing checklist".
</action>

<acceptance_criteria>
- `test -f .planning/phases/03-testing-and-polish/WSL2-CHECKLIST.md`
- `grep -q "WSL2" WSL2-CHECKLIST.md`
- `grep -q "file watching" WSL2-CHECKLIST.md`
- File committed
</acceptance_criteria>

**Requirements covered:** P3.1 (WSL2 coverage)

---

### Task P3.4: Instrument Debug Logging (2h)

**Goal:** Integrate the `debug` package to provide verbose diagnostics when needed.

<read_first>
- src/rc.ts
- src/pipe-client.ts
- src/daemon.ts
- src/platform.ts
</read_first>

<action>
1. Add `debug` to dependencies:
   - Run `npm install debug` (or if using manual edit: add `"debug": "^4.3.5"` to package.json dependencies and run `npm install`).
2. In each module, create a debug namespace:
   - `rc.ts`: `const debug = require('debug')('claude-remote:rc');`
   - `pipe-client.ts`: `const debug = require('debug')('claude-remote:pipe-client');`
   - `daemon.ts`: `const debug = require('debug')('claude-remote:daemon');`
   - `platform.ts`: `const debug = require('debug')('claude-remote:platform');`
3. Add debug logs at key points:
   - **platform.ts**: at start of each exported function, log inputs and return values (e.g., `debug('getPlatform: %s', process.platform)`). Ensure logs are not noisy by default.
   - **rc.ts**: log when pipe server starts (`debug('Starting pipe server at %s', PIPE_PATH)`), when socket cleanup occurs, when daemon starts/stops, when status flag set, when Claude binary path found.
   - **pipe-client.ts**: log when findPipe scans registry, when socket connection succeeds/fails, timeout occurrences.
   - **daemon.ts**: log IPC messages from parent, channel creation, message batching, watcher events, cleanup steps.
4. Ensure all debug logs are guarded by `if (debug.enabled) { ... }` or simply using the debug function (which short-circuits when disabled). The `debug` library handles this automatically.
5. Update `package.json` scripts to optionally enable debug: add `"debug": "DEBUG=claude-remote:* claude-remote $*"` (for Linux/mac) and `"debug:win": "set DEBUG=claude-remote:* && claude-remote %*"` for Windows (optional).
6. Update README.md with a "Debugging" section explaining how to enable debug logs using `DEBUG=claude-remote:*` and what each namespace covers.
</action>

<acceptance_criteria>
- `grep '"debug"' package.json` shows dependency
- `grep "require('debug')" src/rc.ts src/pipe-client.ts src/daemon.ts src/platform.ts` all appear
- `grep "debug('claude-remote:" src/*.ts` shows namespace uses
- Running `DEBUG=claude-remote:* claude-remote --version` outputs debug logs to stderr (including platform detection, pipe path, etc.)
- README.md contains a "Debugging" section with instructions and namespace breakdown
- Build succeeds (`npm run build`)
- Files committed: package.json, src/*.ts, README.md
</acceptance_criteria>

**Requirements covered:** P3.3 (debug logging)

---

### Task P3.5: Proactive Config Dir Error Handling (1h)

**Goal:** Catch and surface filesystem errors when creating critical directories (config, status, sessions) to aid troubleshooting on locked-down distros.

<read_first>
- src/rc.ts (functions: saveConfig, setStatusFlag, installAlias)
- src/daemon.ts (function: saveSessionChannel)
</read_first>

<action>
1. In `src/rc.ts`:
   - Modify `saveConfig` to wrap `fs.mkdirSync(CONFIG_DIR, { recursive: true })` in a try/catch. On error, log: `console.error(\`[rc] Failed to create config directory at ${CONFIG_DIR}: \${err.message}\`); re-throw err`.
   - Modify `setStatusFlag` to wrap the `fs.mkdirSync(path.dirname(STATUS_FLAG), ...)` similarly: `console.error(\`[rc] Failed to create status directory: \${err.message}\`); re-throw`.
   - Modify `installAlias` to wrap the `fs.mkdirSync(path.dirname(target.profilePath), ...)` similarly, using `console.error(\`[rc] Failed to create directory for \${target.profilePath}: \${err.message}\`)`.
2. In `src/daemon.ts`:
   - Modify `saveSessionChannel` to wrap `fs.mkdirSync(path.dirname(SESSIONS_FILE), ...)` in try/catch and log `console.error(\`[daemon] Failed to create sessions directory: \${err.message}\`);`.
   - Also wrap the `fs.writeFileSync` itself to catch and log errors (currently uncaught).
3. Ensure error messages include the problematic path and provide actionable hint (e.g., "check write permissions").
4. No change to behavior beyond better diagnostics; errors still propagate to crash (which is appropriate for misconfigured system).
</action>

<acceptance_criteria>
- `grep -A2 'mkdirSync.*recursive' src/rc.ts` shows try/catch around both calls (CONFIG_DIR and STATUS_FLAG dir)
- `grep -A2 'mkdirSync.*recursive' src/rc.ts` also shows catch around installAlias dir creation
- `grep -A2 'mkdirSync.*recursive' src/daemon.ts` shows try/catch in saveSessionChannel
- `grep -A2 'writeFileSync' src/daemon.ts` shows try/catch around sessions file write
- Error messages contain the path and "Failed"
- Build succeeds
- Files committed
</acceptance_criteria>

**Requirements covered:** P3.2 (robustness)

---

### Task P3.6: Ensure UTF-8 Locale for PTY (0.5h)

**Goal:** Force UTF-8 encoding in the PTY to avoid Unicode/emoji issues on distros with LANG unset or not UTF-8.

<read_first>
- src/rc.ts (pty.spawn options)
</read_first>

<action>
1. In `src/rc.ts`, modify the `pty.spawn` call to include an `env` object that guarantees `LANG` and `LC_ALL` are set to `C.UTF-8` if not already defined:
   ```typescript
   const env = { ...process.env };
   env.LANG = process.env.LANG || 'C.UTF-8';
   env.LC_ALL = process.env.LC_ALL || 'C.UTF-8';
   const proc = pty.spawn(CLAUDE_BIN, process.argv.slice(2), {
     name: "xterm-color",
     cols: process.stdout.columns || 120,
     rows: process.stdout.rows || 30,
     cwd: projectDir,
     env,
   });
   ```
2. Add a debug log: `debug('PTY env: LANG=%s, LC_ALL=%s', env.LANG, env.LC_ALL);`.
3. This ensures consistent UTF-8 behavior across all distros regardless of user's locale settings.
4. Update TESTING.md to include a test case: "Unicode/emoji display" — verify emojis appear correctly in terminal and Discord.
</action>

<acceptance_criteria>
- `grep -A5 'pty.spawn' src/rc.ts` shows `env` variable constructed with spread and LANG/LC_ALL assignments
- `grep "env.LANG" src/rc.ts` appears
- `grep "LC_ALL" src/rc.ts` appears
- Build succeeds
- File committed
</acceptance_criteria>

**Requirements covered:** P3.2 (Unicode issues)

---

### Task P3.7: Add Socket Connection Error Context (0.5h)

**Goal:** Improve error message when `sendPipeMessage` fails to connect, helping users diagnose socket-related issues.

<read_first>
- src/pipe-client.ts (sendPipeMessage function)
- src/remote-cmd.ts (calls sendPipeMessage)
</read_first>

<action>
1. In `src/pipe-client.ts`, within `sendPipeMessage`, modify the `socket.on('error')` handler to add more context:
   ```typescript
   socket.on('error', (err) => {
     if (settled) return;
     settled = true;
     clearTimeout(timer);
     // Enhance error with helpful hint
     if (err.code === 'ECONNREFUSED' || err.code === 'EACCES') {
       err.message = `${err.message}. Ensure claude-remote daemon is running and you have permission to access the socket (run as same user).`;
     }
     reject(err);
   });
   ```
2. Optionally add debug log: `debug('Pipe connection failed: %s %s', err.code, err.message);`.
3. No changes needed to `remote-cmd.ts`; it already prints `ERROR: ${err.message}`.
</action>

<acceptance_criteria>
- `grep -A10 "socket.on('error'" src/pipe-client.ts` shows code that checks `err.code` and modifies message
- Messages contain "Ensure claude-remote daemon is running" for ECONNREFUSED/EACCES
- Build succeeds
- File committed
</acceptance_criteria>

**Requirements covered:** P3.2 (socket errors)

---

### Task P3.8: Document Alpine Compatibility Considerations (1h)

**Goal:** Add guidance about building on Alpine Linux (musl) to README or a new COMPATIBILITY.md.

<read_first>
- README.md (existing content)
- TESTING.md (Alpine test notes)
</read_first>

<action>
1. Create `.planning/phases/03-testing-and-polish/COMPATIBILITY.md` with:
   - Distribution support matrix: Ubuntu ✅, Fedora ✅, Alpine ⚠️ (requires additional steps), WSL2 ⚠️ (known quirks).
   - For Alpine: required packages: `apk add build-base python3 linux-headers`. Node-gyp可能需要。说明 node-pty 需要编译，提供完整命令。
   - Known limitations: If node-pty build fails, claude-remote cannot function; consider using glibc-based distro instead.
   - Performance notes: musl may be slightly faster but less prebuilt binaries.
2. Update README.md "Installation" section to include a link to COMPATIBILITY.md and brief note about Alpine.
3. Commit both files (if COMPATIBILITY.md added) or update README if only that.
</action>

<acceptance_criteria>
- `test -f .planning/phases/03-testing-and-polish/COMPATIBILITY.md` OR `grep -q "Alpine" README.md`
- `grep -q "build-base" COMPATIBILITY.md` (if file exists)
- `grep -q "Alpine" README.md` if no separate file
- Files committed
</acceptance_criteria>

**Requirements covered:** P3.2 (Alpine support documentation)

---

### Task P3.9: Run Verification Tests and Produce Report (2h)

**Goal:** Execute the test matrix on available environments (at least Ubuntu) and document results. Formally close the phase if all acceptance criteria met.

<read_first>
- TESTING.md (test cases)
- WSL2-CHECKLIST.md (if applicable)
- .planning/phases/03-testing-and-polish/ (existing)
</read_first>

<action>
1. On the primary development machine (Linux Ubuntu 22.04 or WSL2), perform the following:
   - Build: `npm ci && npm run build` → succeeds without errors.
   - Run smoke tests: `npm run test:smoke` → both commands exit 0.
   - Install globally: `npm install -g --prefix ~/.npm-global .` and add `~/.npm-global/bin` to PATH for session.
   - Run `claude-remote --version` → prints version.
   - Run `claude-remote help` → shows usage.
   - If a test Discord bot token is available, run `claude-remote setup` in non-interactive mode using environment variables (e.g., `DISCORD_BOT_TOKEN`, `DISCORD_GUILD_ID`, `DISCORD_CATEGORY_ID`) and p-prompt? Actually setup is interactive; we can skip full interactive test in CI, but manual verification can be done if desired.
   - Run `claude-remote uninstall` to ensure it doesn't crash.
2. Create `.planning/phases/03-testing-and-polish/TESTING_REPORT.md` with:
   - Date of test
   - Environment details (OS, Node version, npm version)
   - Table filled with results for Ubuntu (and Fedora/Alpine if tested manually)
   - Notes on any issues encountered (even if resolved)
   - Conclusion: "All critical tests passed" or "Issues found and fixed in tasks P3.5-P3.8"
3. Run the verification checklist (similar to Phase 1's plan-verification but simplified) to ensure no regressions in core functionality.
4. If any critical issue remains, either fix immediately using tasks P3.5-P3.8 or create a new gap closure plan.
5. Commit `TESTING_REPORT.md` with message: "test(phase-03): complete testing report — all critical tests passed".
</action>

<acceptance_criteria>
- `test -f .planning/phases/03-testing-and-polish/TESTING_REPORT.md`
- `grep -q "Ubuntu" TESTING_REPORT.md`
- `grep -q "passed" TESTING_REPORT.md` (or similar success indicator)
- Report includes at least Ubuntu test results; other distros marked as "manual pending" if not run
- No open critical issues (blocker/major) unresolved in report
- File committed
</acceptance_criteria>

**Requirements covered:** P3.1 (execution of tests), P3.2 (bug fixing within this task if needed)

---

## plan-verification

After all tasks complete, verify phase success by performing the following on a Linux machine:

1. **Build validation**:
   - `npm ci` finishes without errors
   - `npm run build` compiles TypeScript with no type errors
   - `npm pack` produces a tarball

2. **Installation validation**:
   - `npm install -g --prefix ~/.npm-global .` succeeds
   - `claude-remote --version` prints version string
   - `which claude-remote` resolves to global bin path

3. **Smoke test**:
   - `npm run test:smoke` exits 0
   - `claude-remote help` contains "Remote Control for Claude Code"
   - `claude-remote` with no args shows help or version appropriately

4. **Debug logging check**:
   - `DEBUG=claude-remote:* claude-remote --version` emits debug lines mentioning namespaces (e.g., `claude-remote:platform`, `claude-remote:rc`)

5. **Error handling check** (simulate permission error):
   - Create a temporary directory owned by root (requires sudo) or adjust permissions of config dir to 0, then run `claude-remote` and observe error messages that include "Failed to create config directory" and mention permissions.

6. **Compatibility docs**: README or COMPATIBILITY.md mentions Alpine build requirements.

7. **GitHub Actions**: Push branch and verify `test-ubuntu` workflow triggers and passes (if repository hosted on GitHub with Actions enabled).

If all items pass, phase is complete.

**Success criteria (Nyquist dimensions):**

- **Dimension 2 (Frontmatter):** PLAN.md has required fields (title, description, wave, depends_on, files_modified, autonomous, requirements).
- **Dimension 4 (Deep work):** Every task has `<read_first>`, `<action>` with concrete values, `<acceptance_criteria>` with verifiable greps.
- **Dimension 6 (Verification):** Plan includes acceptance criteria per task and a post-plan verification checklist.
- **Dimension 8 (Validation architecture):** Testing strategy is documented in TESTING.md and executed; debug logging aids future diagnostics.
- **Dimension 9 (Goal-backward):** `must_haves` listed below directly map to phase goal.

**must_haves (critical for phase completion):**

- [ ] TESTING.md defined with test matrix for Ubuntu, Fedora, Alpine, WSL2
- [ ] GitHub Actions workflow exists and passes on Ubuntu
- [ ] Smoke test script (`npm run test:smoke`) passes locally
- [ ] Debug logging integrated with `debug` package in rc.ts, pipe-client.ts, daemon.ts, platform.ts
- [ ] README.md includes Debugging section
- [ ] Proactive error handling added to config dir creation and session file writes
- [ ] UTF-8 locale forced in PTY env
- [ ] Socket connection errors provide actionable hint
- [ ] Alpine compatibility documented
- [ ] TESTING_REPORT.md created with at least Ubuntu results; all critical issues resolved

**Documentation updates required:**

- README.md updated with Debugging section (Task P3.6)
- Possibly COMPATIBILITY.md added (Task P3.8)

---

**End of PLAN.md**
