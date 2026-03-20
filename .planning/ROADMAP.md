# Roadmap: Linux Support (v2.0)

**Milestone**: v2.0 — Cross-platform claude-remote
**Start date**: 2025-03-20
**Target completion**: 2-3 weeks (part-time)
**Status**: Planning phase

---

## Phase Overview

| Phase | Name | Goal | Est. Duration | Status |
|-------|------|------|---------------|--------|
| 1 | Platform Abstraction | Core cross-platform infrastructure | 2-3 days | Planned |
| 2 | Linux Shell Integration | Setup wizard installs aliases for bash/zsh/fish | 1 day | Planned |
| 3 | Testing & Polish | Validate on Linux, fix bugs, improve UX | 2-3 days | Planned |
| 4 | Documentation & Release | Update README, write changelog, publish | 1 day | Planned |

**Total**: ~6-8 days of development work (spread across 1-2 weeks)

---

## Phase 1: Platform Abstraction (P1)

**Objective**: Create abstraction layer and fix critical blockers (IPC, binary, paths).

### Tasks

#### P1.1: Create `src/platform.ts`

**Estimated**: 2h

Implement:

```typescript
export function getPlatform(): 'win32' | 'linux' | 'darwin';
export function getClaudeBinary(): string;
export function getPipePath(): string;
export function getConfigDir(): string;
export function getShellProfiles(): Array<{ path: string; line: string; marker: string }>;
export function shouldCleanupSocket(): boolean; // true for non-Windows
```

Add unit tests for each function (if test suite exists; otherwise manual verification checklist).

**Acceptance**:
- All functions return correct values on current platform (Linux)
- Windows values match existing behavior (regression prevention)

---

#### P1.2: Update `src/rc.ts` – Socket & Binary

**Estimated**: 2h

Changes:
- Replace `const PIPE_NAME = ...` with `const PIPE_PATH = getPipePath()`
- In `startPipeServer()`: `net.createServer().listen(PIPE_PATH)` (same API works for both pipe types)
- Add cleanup: if `shouldCleanupSocket()`, `fs.unlinkSync(PIPE_PATH)` before `listen()` and on exit
- Replace `const CLAUDE_BIN = "claude.exe"` with `const CLAUDE_BIN = getClaudeBinary()`
- Ensure terminal restore (`\x1b[?9001l`) remains Windows-only (already guarded)

**Acceptance**:
- Parent starts successfully on Linux (no EADDRNOTAVAIL)
- Socket file created at `/tmp/claude-remote-<pid>.sock`
- Socket file removed on exit
- `claude` binary spawned correctly (verify with `which claude` in PATH)

---

#### P1.3: Update `src/pipe-client.ts` – Socket Discovery

**Estimated**: 1.5h

Changes:
- `findPipe()`: Read pipe registry JSON files (unchanged), but additionally check if the `entry.pipe` path exists as a socket file (`fs.existsSync(entry.pipe)`) for Linux
- On Linux, if socket file doesn't exist but PID alive → stale entry, clean up
- `sendPipeMessage()`: `net.createConnection(pipeName)` works for both Windows pipes and Unix sockets (Node.js auto-detects)
- Add 3-second timeout (already present)

**Acceptance**:
- `remote-cmd status` successfully connects to daemon on Linux
- Stale socket files cleaned up automatically

---

#### P1.4: Update `src/daemon.ts` – Config Dir & Signals

**Estimated**: 1h

Changes:
- Use `getConfigDir()` instead of hardcoded `~/.claude/claude-remote` (if we want XDG compliance)
  - *Alternative*: Keep `~/.claude/claude-remote` for consistency with Claude's own config; research says `~/.claude/` is already cross-platform. **Decision**: Keep as-is, no change needed.
- Add `process.on('SIGPIPE', () => {})` to ignore on Linux (PITFALLS.md:4)
- Verify daemon forked with correct env (already passes through `rc.ts`)

**Acceptance**:
- Daemon starts without crashing on SIGPIPE scenarios
- Config dir remains `~/.claude/claude-remote/` (simple, consistent)

---

#### P1.5: Update `src/cli.ts` – Setup Wizard for Linux

**Estimated**: 1h

Changes:
- `getAliasTargets()`: Conditionally return Windows or Linux shell profiles
- Linux: Check for `~/.bashrc`, `~/.zshrc`, `~/.config/fish/config.fish`
- Use `getShellProfiles()` from `platform.ts` (centralized)
- Ensure `installAlias()` works with Linux paths (create parent dirs if needed)

**Acceptance**:
- `claude-remote setup` on Linux offers to install alias for detected shells
- Aliases correctly appended with marker comment for idempotency
- `claude-remote uninstall` removes them

---

#### P1.6: Update `src/utils.ts` – Platform Constants

**Estimated**: 0.5h

Changes:
- Replace hardcoded `CONFIG_DIR` with platform-aware version using `platform.ts` helpers
- Or remove `CONFIG_DIR` entirely and use `platform.getConfigDir()` everywhere

**Acceptance**:
- All code imports `platform` or `utils` and gets correct paths

---

### Phase 1 Verification

Run this checklist on a Linux VM:

- [ ] `npm run build` succeeds without errors
- [ ] `npm install -g` works (with user prefix if no sudo)
- [ ] `claude-remote --version` prints version
- [ ] `claude-remote setup` completes:
  - [ ] Validates bot token
  - [ ] Fetches guilds
  - [ ] Creates/ finds "Claude RC" category
  - [ ] Installs hooks to `~/.claude/settings.json`
  - [ ] Installs `/remote` skill
  - [ ] Offers alias installation → says yes
  - [ ] Detects bash and zsh → installs to both
- [ ] `source ~/.bashrc` → `claude` command exists
- [ ] `claude-remote -p "hello"` starts:
  - [ ] Parent process spawns
  - [ ] PTY spawns `claude` binary (check `ps aux | grep claude`)
  - [ ] Socket file created at `/tmp/claude-remote-<pid>.sock`
  - [ ] Daemon forks, connects to Discord
  - [ ] Channel created in Discord
- [ ] Type "hello" in terminal → Claude responds → Discord message appears
- [ ] `/remote off` → disables sync, daemon stops sending
- [ ] `/remote on` → re-enables, daemon starts
- [ ] `claude-remote uninstall` removes:
  - [ ] Hooks from `~/.claude/settings.json`
  - [ ] Skill directory
  - [ ] Aliases from shell profiles
  - [ ] Config dir
- [ ] Restart terminal → `claude` alias still works (if uninstall didn't remove; after reinstall yes)

---

## Phase 2: Linux Shell Integration Polish (P2)

**Objective**: Ensure setup works smoothly across diverse Linux environments.

### Tasks

#### P2.1: Comprehensive Shell Profiling

**Estimated**: 2h

Improvements:
- Detect more shell config files:
  - `~/.profile` (login shells)
  - `~/.bash_profile` (bash login)
  - `~/.zprofile` (zsh login)
  - `~/.config/fish/config.fish` (fish)
- Avoid duplicate installations to multiple bash files (prefer `~/.bashrc` for interactive, but `~/.profile` for login). Document choice.
- If multiple shells detected, ask user which to install to (or install to all with confirmation)

**Acceptance**:
- Setup correctly identifies user's shell via `$SHELL` env var AND checks config file existence
- Doesn't pollute unrelated config files
- User can skip alias installation if desired (already exists: `p.confirm()`)

---

#### P2.2: PATH Verification

**Estimated**: 1h

Problem: `claude` binary may not be in PATH when `claude-remote` runs, but exists elsewhere.

Solution:
- After `getClaudeBinary()` returns `'claude'`, use `which` command or `which` npm package to locate full path
- If not found, print helpful error: "Claude Code CLI not found. Install from https://claude.ai/install or ensure ~/.local/bin is in PATH"

**Acceptance**:
- `claude-remote` with Claude not in PATH → clear error message
- After adding Claude to PATH → works

---

#### P2.3: Improved Environment Loading

**Estimated**: 1h

Problem: Users may set `DISCORD_*` env vars in `~/.profile` but they don't load for non-login shells.

Solution:
- On Linux, try loading `~/.config/claude-remote/.env` if present (use `dotenv` package)
- Document: "You can put your Discord credentials in `~/.config/claude-remote/.env`"

**Acceptance**:
- Create `~/.config/claude-remote/.env` with `DISCORD_BOT_TOKEN=...`
- Run `claude-remote` (no exported env) → daemon picks up from .env file
- .env file ignored by git (already in .gitignore)

---

#### P2.4: systemd --user Service (Optional)

**Estimated**: 2h

Provide optional systemd unit file for "always-on" background operation.

Implementation:
- During `setup`, ask: "Install systemd --user service for auto-start on login?" (optional)
- If yes, write unit file to `~/.config/systemd/user/claude-remote.service`
- Enable with `systemctl --user enable claude-remote`
- Provide command to start/stop: `systemctl --user start claude-remote`

**Acceptance**:
- Service file installed with correct `ExecStart` and `EnvironmentFile`
- `systemctl --user status claude-remote` shows active after boot
- Service restarts daemon on crash

**Decision**: May defer to post-v2.0 release. Keep as stretch goal.

---

### Phase 2 Verification

- [ ] Alias installed to correct files based on detected shell
- [ ] `which claude` check provides clear guidance
- [ ] `.env` file loading works
- [ ] No duplicate alias lines in shell profiles
- [ ] systemd service (if implemented) starts on boot and restarts on failure

---

## Phase 3: Testing & Polish (P2)

**Objective**: Ensure stability across Linux distros, fix bugs, refine UX.

### Tasks

#### P3.1: Multi-Distro Testing

**Estimated**: 2-3 days (wall time, includes waiting for CI)

- Test on Ubuntu 22.04 (glibc)
- Test on Fedora (glibc)
- Test on Alpine Linux 3.19+ (musl) if claiming support
  - May need to disable Alpine if node-pty build fails (document limitation)
- Test on WSL2 (Ubuntu) – note potential file watching issues

Create test report with:
- Installation success/failure
- Build issues (node-pty compilation)
- Runtime issues (socket permissions, inotify limits)
- Performance observations

**Acceptance**:
- At least Ubuntu 22.04 works flawlessly
- Alpine either works or documented as "not officially supported"

---

#### P3.2: Fix bugs found in testing

**Estimated**: 1-2 days

Address any issues discovered in P3.1:
- Socket permission problems
- Config dir creation failures
- Shell profile detection edge cases
- Signal handling quirks
- Unicode/emoji display in PTY

**Acceptance**:
- All critical and high-severity bugs fixed
- Medium-severity bugs documented or mitigated

---

#### P3.3: Add Debug Logging (Optional)

**Estimated**: 1h

Integrate `debug` package for optional verbose logging:

```bash
DEBUG=claude-remote:* claude-remote -p "test"
```

Add debug logs in:
- `rc.ts` (socket server start/stop, PTY spawn)
- `pipe-client.ts` (connection attempts)
- `daemon.ts` (JSONL watch, message batches)
- `platform.ts` (platform detection)

**Acceptance**:
- Debug output helpful for troubleshooting without cluttering normal logs

---

### Phase 3 Verification

- [ ] Test matrix passed (Ubuntu ✓, Fedora ✓, Alpine ?)
- [ ] No crashes in 24h continuous run
- [ ] Signal handling clean (no zombies)
- [ ] Unicode output renders correctly in terminal and Discord
- [ ] Debug mode provides useful diagnostics

---

## Phase 4: Documentation & Release (P1)

**Objective**: Guide users through Linux setup; publish v2.0.0.

### Tasks

#### P4.1: Update README.md

**Estimated**: 2h

Sections to add/modify:
- "Platform Support" – announce Linux support
- "Installation on Linux" – step-by-step with distro notes
- "Prerequisites" – Node.js 18+, build-essential, Claude Code CLI install command
- "Configuration" – environment variables, `.env` file
- "Troubleshooting" – common errors (EACCES, claude not found, Discord intents)
- Update screenshots if needed (Discord UI same)

**Acceptance**:
- README is comprehensive and accurate for Linux
- New users can install and run without additional help

---

#### P4.2: Changelog & Version Bump

**Estimated**: 0.5h

- Update `CHANGELOG.md` (create if missing) with v2.0.0 entry summarizing:
  - "Added Linux support for Ubuntu, Debian, Fedora, Alpine"
  - "Added bash/zsh/fish shell integration"
  - "Fixed: Platform-specific IPC via Unix domain sockets"
  - "Changed: Config directory now XDG-compliant on Linux (~/.config/claude-remote)"
  - "Known issues: WSL2 not officially supported, Alpine may require manual build"
- Bump version in `package.json` to `2.0.0`
- Update `dist/` by rebuilding

**Acceptance**:
- `npm view @hoangvu12/claude-remote version` shows 2.0.0 after publish
- Changelog reflects all major changes

---

#### P4.3: Publish to npm

**Estimated**: 0.5h

```bash
npm publish --access public
```

(Existing GitHub Action may automate on release; can also do manual release)

**Acceptance**:
- `npm install -g @hoangvu12/claude-remote@2.0.0` installs successfully on Linux
- Binary links created correctly (`/usr/local/bin/claude-remote` or user prefix)

---

#### P4.4: Announcement

**Estimated**: 0.5h

- Create GitHub Release with release notes (copy from CHANGELOG)
- Post in Discord community (if exists)
- Update project status in relevant forums (Hacker News, Reddit r/ClaudeAI)

**Acceptance**:
- Release page visible
- Users can discover v2.0.0

---

### Phase 4 Verification

- [ ] README updated with Linux instructions
- [ ] CHANGELOG reflects v2.0.0 changes
- [ ] npm publish succeeds
- [ ] GitHub Release created with release notes
- [ ] Installation from npm works on Linux

---

## Risk Mitigation Checklist

- [ ] **Windows regression**: Test all manual checklist items on Windows after each phase
- [ ] **Alpine compatibility**: Build test in `node:20-alpine` Docker image early (P1.6)
- [ ] **Socket cleanup**: Verify `/tmp` doesn't fill with stale `.sock` files (P1.2)
- [ ] **Unicode issues**: Test with emoji and CJK characters (P3.3)
- [ ] **Permission errors**: Test installation without sudo, config dir creation (P2.2)

---

## Rollback Plan

If critical issues are discovered post-release:

1. **Patch release** (v2.0.1) within 24h for critical bugs
2. **Yank** from npm if security or major data loss risk (unlikely)
3. **Windows fallback**: Since changes are platform-conditional, Windows users unaffected by Linux bugs

---

## Milestone Completion Criteria

- ✅ All Phase 1-4 tasks completed
- ✅ Manual integration test passes on Linux (checklist in Phase 1)
- ✅ Windows manual integration test still passes (regressions checked)
- ✅ README comprehensive for Linux users
- ✅ npm package published as v2.0.0
- ✅ Users can install and run on at least Ubuntu 22.04 without assistance

---

**Ready to execute**: After requirements approval, proceed to `/gsd:plan-phase 1` to create detailed PLAN.md for Phase 1.
