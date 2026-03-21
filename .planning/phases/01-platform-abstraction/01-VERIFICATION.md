---
phase: 01
status: human_needed
verifier: gsd-verifier
---

# Phase 1 Verification: Platform Abstraction

**Verification Status:** Human testing required (automated checks limited)

**Required Environment:** Linux (Ubuntu 22.04+ or similar) for full validation; Windows for regression check

---

## Automated Checks (Code-level)

These can be verified by grep/inspection:

- [x] `src/platform.ts` exists and exports all 6 functions
- [x] `rc.ts` imports platform module and uses `PIPE_PATH`, `CLAUDE_BIN`
- [x] `rc.ts` registers socket cleanup for non-Windows (exit handler, before listen)
- [x] `pipe-client.ts` imports platform and checks `shouldCleanupSocket()` in `findPipe()`
- [x] `daemon.ts` imports `getConfigDir()` and `getPlatform()`, defines `CONFIG_DIR` locally
- [x] `daemon.ts` sets `SIGPIPE` ignore only on non-Windows
- [x] `cli.ts` imports platform and conditionally returns Linux shells in `getAliasTargets()`
- [x] `utils.ts` no longer exports `CONFIG_DIR` (uses platform.getConfigDir internally)
- [x] `statusline.ts` uses platform.getConfigDir()
- [x] All edits preserve Windows branches (grep for `win32` shows multiple hits in rc.ts, platform.ts, cli.ts)

**Automated verification result:** ✓ All code-level checks passed

---

## Human Testing Checklist (Linux VM or WSL2)

**Prerequisites:**
- Node.js 18+ installed
- Build tools available (`npm install` succeeds)
- Claude Code CLI installed (`claude` in PATH)
- Discord bot token configured

**Test procedure:**

1. **Build**
   - [ ] `npm run build` completes without TypeScript errors
   - [ ] `npm install -g --prefix ~/.npm-global .` succeeds
   - [ ] `export PATH=~/.npm-global/bin:$PATH` and `claude-remote --version` prints version

2. **Setup**
   - [ ] `claude-remote setup` runs and asks for bot token, guild ID, category ID
   - [ ] Hooks installed to `~/.claude/settings.json`
   - [ ] `/remote` skill installed
   - [ ] Aliases offered: "Detected shells: bash, zsh" (or similar)
   - [ ] After confirming, alias lines appear in `~/.bashrc` and/or `~/.zshrc` with marker `# claude-remote-alias`
   - [ ] `source ~/.bashrc` → `type claude` shows function

3. **Start daemon**
   - [ ] `claude-remote -p "test"` spawns PTY and connects to Discord
   - [ ] Socket file created: `ls /tmp/claude-remote-<pid>.sock` shows file
   - [ ] Daemon logs show connected to Discord gateway
   - [ ] Channel created in Discord (or reused)

4. **Message flow**
   - [ ] Type "hello" in terminal → Claude responds → Discord message appears
   - [ ] Send Discord message → appears in terminal (Claude responds)
   - [ ] Tool approval (Allow/Deny) works bidirectionally

5. **Commands**
   - [ ] `/remote off` → Discord posts "sync disabled" or similar
   - [ ] `/remote on` → Discord posts "sync enabled"
   - [ ] `/stop` → clean exit
   - [ ] `/clear` → clears context

6. **Cleanup**
   - [ ] Kill parent (`pkill -f claude-remote`) → daemon exits
   - [ ] Socket file removed from `/tmp`
   - [ ] `claude-remote uninstall` removes hooks, skill, aliases, config dir

7. **Windows regression** (if Windows environment available)
   - [ ] Build on Windows (or cross-compile) succeeds
   - [ ] `claude-remote -p "test"` starts with Windows named pipe (`\\.\pipe\...`)
   - [ ] Terminal restore works (no raw mode stuck)
   - [ ] Discord connectivity works

---

## Issues Found

None during code review. Human testing pending.

---

## Verdict

**Current status:** `human_needed`

**Reason:** Automated code checks passed, but integration testing on actual Linux environment required to validate IPC, PTY, and Discord connectivity. This cannot be fully automated in this context.

**Next action:** Run manual test checklist above. If all pass → mark `passed`. If failures → create gap closure plan via `/gsd:plan-phase 1 --gaps`.

---

**Manual verification sign-off:**

- [ ] All Linux tests passed
- [ ] Windows regression test passed (or documented as not tested)

Verified by: _______________ Date: ___________
