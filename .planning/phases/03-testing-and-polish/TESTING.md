# Phase 3: Multi-Distro Testing Guide

## Introduction

This document outlines the testing procedures for validating `claude-remote` on multiple Linux distributions. The goal is to ensure consistent functionality across Ubuntu, Fedora, Alpine, and WSL2 environments.

**Target Distributions:**
- Ubuntu 22.04 (primary target, glibc)
- Fedora (latest, glibc)
- Alpine Linux 3.19+ (musl)
- WSL2 (Ubuntu, with file watching considerations)

**Success Criteria:**
- Build completes without errors
- Installation succeeds
- Basic `-p` mode works
- Setup wizard completes
- Uninstall cleans up properly

---

## Test Matrix

| Distro | Build | Install | Basic -p | Setup Wizard | Uninstall | Notes |
|--------|-------|---------|----------|--------------|-----------|-------|
| Ubuntu 22.04 | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | Primary target |
| Fedora (latest) | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | Need test |
| Alpine 3.19+ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | May require build dependencies |
| WSL2 (Ubuntu) | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | File watching quirks possible |

---

## Prerequisites per Distro

### All Distributions
- **Node.js 18+** (use nvm or distro package manager)
- **Git** and **curl**
- **Claude Code CLI** — install via:
  ```bash
  curl -fsSL https://claude.ai/install.sh | bash
  ```

### Ubuntu / Debian
```bash
sudo apt-get update
sudo apt-get install -y build-essential python3
```

### Fedora
```bash
sudo dnf groupinstall "Development Tools"
sudo dnf install -y python3
```

### Alpine Linux 3.19+
```bash
apk add build-base python3 linux-headers
```
Note: `node-pty` requires compilation; these packages provide the necessary toolchain.

### WSL2 (Ubuntu)
Same as Ubuntu above. Ensure Windows host has Discord access and network connectivity.

---

## Installation Steps

1. **Clone or download source:**
   ```bash
   git clone <repository-url>
   cd claude-remote
   ```

2. **Install dependencies:**
   ```bash
   npm ci
   ```

3. **Build:**
   ```bash
   npm run build
   ```

4. **Install globally:**
   ```bash
   npm install -g --prefix ~/.npm-global .
   ```
   Add `~/.npm-global/bin` to PATH, or use `sudo` for system-wide install.

5. **Verify installation:**
   ```bash
   claude-remote --version
   ```

---

## Test Cases

### TC1: Help Output
```bash
claude-remote help
```
**Expected:** Exit code 0, displays usage information.

---

### TC2: Setup Wizard
```bash
claude-remote setup
```
**Steps:**
1. Provide bot token (use a test token from Discord Developer Portal)
2. Select guild ID
3. Select or create category
4. Complete setup
5. Observe alias installation message

**Expected:** Setup completes without errors; alias installation message appears.

---

### TC3: Basic Session
```bash
claude-remote -p "hello"
```
**Steps:**
1. Run command
2. Verify Discord channel created and message appears
3. Wait for Claude response to appear in terminal
4. Exit cleanly

**Expected:**
- Daemon starts and connects to Discord
- Parent process spawns `claude` PTY
- Socket file created at `/tmp/claude-remote-<pid>.sock`
- Message delivered to Discord
- Claude responds, output visible in terminal
- Clean exit (no zombies, socket removed)

---

### TC4: Status Toggle
1. Start a session: `claude-remote -p "test"`
2. Inside session, type: `/remote off`
3. Observe Discord status message
4. Type: `/remote on`
5. Observe Discord status message

**Expected:** Status toggle messages appear in Discord; sync enabled/disabled accordingly.

---

### TC5: Uninstall
```bash
claude-remote uninstall
```
**Expected:** No crashes; config directory, hooks, skill directory, and aliases removed.

---

## Expected Observations

During all tests, monitor for:

- **Socket file:** Created at `/tmp/claude-remote-<pid>.sock` (Linux/macOS)
- **Daemon logs:** Written to `~/.claude/claude-remote/daemon.log`
- **No uncaught exceptions** or crashes in either terminal or daemon
- Clean process termination (no zombie processes)
- Proper cleanup of socket file on exit

---

## Reporting

After completing tests on a distribution:

1. Fill the Test Matrix table above with ✅ (passed) or ⬜ (not tested/failed).
2. Capture terminal output and exit codes for each test case.
3. Note any error messages, even if resolved during testing.
4. Document distro-specific issues (e.g., permission errors, build failures, runtime quirks).

Example report format:

```markdown
### Ubuntu 22.04 Results
- Build: ✅
- Install: ✅
- Basic -p: ✅
- Setup Wizard: ✅
- Uninstall: ✅
- Notes: All tests passed cleanly. Socket permissions correct. No issues observed.
```

---

## WSL2 Notes

**Specific considerations for WSL2:**

- **File watching:** When editing files from Windows (via `/mnt/c/...`), inotify events may be delayed or missed. Verify JSONL changes are detected promptly when editing from Windows editor vs. Linux-side editor.
- **Terminal behavior:** PTY rendering, colors, and Unicode output should be verified; WSL2 sometimes has different terminal emulation characteristics.
- **Socket cleanup:** After exiting WSL2, `/tmp/claude-remote-*.sock` should be cleaned by WSL shutdown; check for stale sockets on next start.

Document any quirks found in the WSL2 test results.

---

## Automated Checks (CI)

For Ubuntu, an automated GitHub Actions workflow exists (`.github/workflows/test.yml`) that runs:
- Build (`npm run build`)
- Smoke tests (`npm run test:smoke`)

This provides continuous integration to catch regressions on push and PRs.

---

**End of TESTING.md**
