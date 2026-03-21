# Multi-Distro Testing Strategy — Phase 3

## Introduction

This document defines the test matrix and procedures for validating `claude-remote` on Linux distributions: Ubuntu 22.04, Fedora, Alpine Linux, and WSL2. The goal is to ensure the application installs, builds, runs, and uninstalls correctly across environments, with special attention to native module compilation (`node-pty`), Unix socket permissions, and file watching behavior.

**Success criteria:**
- Ubuntu 22.04: all tests pass flawlessly
- Fedora: all tests pass
- Alpine Linux: either passes or documented as not officially supported if node-pty build fails
- WSL2: core functionality works; file watching quirks documented if present

---

## Test Matrix

| Distro       | Build | Install | Basic `-p` | Setup Wizard | Uninstall | Notes                              |
|--------------|-------|---------|------------|--------------|-----------|------------------------------------|
| Ubuntu 22.04 | ⬜     | ⬜       | ⬜          | ⬜            | ⬜         | Primary target                     |
| Fedora       | ⬜     | ⬜       | ⬜          | ⬜            | ⬜         | Test with dnf build tools           |
| Alpine 3.19+ | ⬜     | ⬜       | ⬜          | ⬜            | ⬜         | May require build-base, python3    |
| WSL2 (Ubuntu)| ⬜     | ⬜       | ⬜          | ⬜            | ⬜         | File watching may need adjustment  |

⬜ = pending; ✅ = passed; ❌ = failed

---

## Prerequisites per Distro

### Ubuntu 22.04 (and Debian-based)

```bash
sudo apt-get update
sudo apt-get install -y build-essential python3 curl git
```

### Fedora (latest)

```bash
sudo dnf groupinstall -y "Development Tools"
sudo dnf install -y python3 curl git
```

### Alpine Linux 3.19+

```bash
sudo apk add build-base python3 curl git
```

**Note:** `node-pty` requires compilation; ensure you have `make`, `g++`, and Python 3 available.

### WSL2 (Ubuntu)

Same as Ubuntu 22.04. Additionally, ensure Windows host has Node.js and Git installed if editing from Windows side; file watching between Windows filesystem (`/mnt/c/...`) and Linux may be slower.

---

## Common Pre-Steps

Install Node.js 18+ (use nvm or distro packages):

```bash
# Using nvm (recommended)
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.0/install.sh | bash
nvm install 22
nvm use 22
```

Install Claude Code CLI:

```bash
curl -fsSL https://claude.ai/install.sh | bash
# Verify: claude --version
```

---

## Installation Steps

1. **Obtain source** (clone or extract tarball)

2. **Install dependencies**
   ```bash
   npm ci
   ```

3. **Build**
   ```bash
   npm run build
   ```

4. **Global install** (user prefix to avoid sudo)
   ```bash
   npm install -g --prefix ~/.npm-global .
   export PATH=~/.npm-global/bin:$PATH
   # To make permanent, add `export PATH=~/.npm-global/bin:$PATH` to shell rc.
   ```

5. **Verify installation**
   ```bash
   claude-remote --version
   ```

---

## Test Cases

### TC1: Help Output
```bash
claude-remote help
```
**Expected:**
- Exit code 0
- Usage text displayed showing commands: `claude-remote`, `claude-remote setup`, `claude-remote update`, `claude-remote uninstall`, `claude-remote help`

---

### TC2: Setup Wizard
```bash
claude-remote setup
```
**Manual interactive steps:**
1. Paste a Discord bot token (use a test bot)
2. Select a guild (if multiple)
3. Accept defaults for category creation
4. Confirm alias installation when prompted

**Expected:**
- Token validation succeeds
- Guild list fetched
- "Claude RC" category found or created
- Configuration saved to `~/.claude/claude-remote/config.json`
- `/remote` skill, hooks, and statusline installed
- Shell alias installation offered; if selected, message shows installed to `~/.bashrc` or `~/.zshrc`

---

### TC3: Basic Session
```bash
claude-remote -p "hello"
```
**Manual verification:**
- PTY starts, Claude CLI appears
- Your "hello" prompt is sent
- Claude responds (you see output)
- Session ends after response or you press Ctrl+C

**Expected:**
- No crashes or uncaught exceptions
- Discord channel created (if daemon enabled)
- Messages appear in Discord
- Socket file appears at `/tmp/claude-remote-<pid>.sock` (Linux) or named pipe on Windows
- On exit, socket is cleaned up

---

### TC4: Status Toggle
Inside a `claude-remote` session:

```
/remote off
/remote on
```

**Expected:**
- Discord receives status messages: "Discord sync disabled" and "Discord sync enabled"
- `/remote-cmd status` from another terminal reflects current state

---

### TC5: Uninstall
```bash
claude-remote uninstall
```
**Expected:**
- Removes `/remote` skill from `~/.claude/skills/remote`
- Removes hooks and statusline from `~/.claude/settings.json`
- Removes aliases from shell profiles (if installed)
- Removes config directory `~/.claude/claude-remote/` (with prompt)
- Exit code 0

---

## Expected Observations

- **Socket path:** `/tmp/claude-remote-<pid>.sock` on Linux/macOS
- **Daemon logs:** `~/.claude/claude-remote/daemon.log` (appended)
- **No uncaught exceptions:** All errors should be caught and logged; process should not crash on normal operations
- **Clean shutdown:** `SIGTERM` and `SIGINT` trigger cleanup; socket removed

---

## Reporting

After testing a distribution, fill the Test Matrix table above with ✅ or ❌ and add notes in the "Notes" column. Also create a short testing report in `.planning/phases/03-testing-and-polish/TESTING_REPORT.md`:

```markdown
# Testing Report — Phase 3

Date: YYYY-MM-DD
Tester: <name>

## Environment
- Distro: Ubuntu 22.04
- Node: v22.x
- npm: 10.x
- Git: 2.xx

## Results

| Test Case | Status | Notes |
|-----------|--------|-------|
| TC1 Help  | ✅     |      |
| TC2 Setup | ✅     |      |
| TC3 Session | ✅   |      |
| TC4 Toggle | ✅    |      |
| TC5 Uninstall | ✅ |      |

## Issues
None (or list with severity)

## Conclusion
All critical tests passed. Ready for next phase.
```

---

## WSL2 Specific Notes

When testing on WSL2:

- **File watching:** If editing files from Windows (e.g., VS Code on Windows host with `/mnt/c/...`), `chokidar` may have higher latency or miss events. Prefer editing inside WSL2 filesystem (`~/project`) for best results.
- **Unicode:** Terminal encoding should be UTF-8; verify emojis render correctly.
- **Socket cleanup:** WSL2 shutdown cleans `/tmp` automatically; verify no stale `.sock` files remain after reboot.

---

## Alpine Compatibility Considerations

If testing on Alpine:

- Ensure `build-base` and `python3` are installed before `npm ci`.
- If `node-pty` fails to build, consider:
  - Using `npm config set python python3`
  - Installing `linux-headers` package
- If build still fails, document as "Alpine not officially supported due to node-pty compilation issues" and mark Alpine tests as blocked. The application can still support glibc-based distros (Ubuntu, Fedora) without Alpine.

---

## End of TESTING.md
