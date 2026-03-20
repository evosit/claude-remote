# Research Summary: Porting claude-remote from Windows to Linux

**Project:** claude-remote (Discord bridge for Claude Code)
**Researched:** 2026-03-20
**Research type:** Pitfalls dimension for Linux porting
**Overall confidence:** HIGH (based on code review, platform knowledge, and existing concerns)

## Executive Summary

This research identifies critical porting challenges when moving a Windows PTY-based Discord bot to Linux. The codebase currently uses Windows-specific named pipes (`\\.\pipe\`), assumes `claude.exe` binary, and relies on ConPTY terminal behavior. The architecture is fundamentally sound, but Linux requires changes to the IPC layer, PTY spawn, file watching, and signal handling. The most critical blocker is the named pipe path format; without fixing this, the application cannot start on Linux. Secondary concerns include inotify watch limits, file truncation handling, signal propagation, and environment validation. Testing strategy needs significant adaptation to include multi-distro CI, TTY-aware integration tests, and debugging support via `DEBUG` logging.

## Key Findings

**Stack:** The existing Node.js stack (node-pty, chokidar, discord.js) is cross-platform capable, but requires platform abstraction and configuration changes for Linux deployment.

**Architecture:** The IPC architecture (parent-daemon via named pipe) and file-watching pipeline need platform-specific implementations while maintaining the same message protocol.

**Critical pitfall:** Windows-only named pipe path format (`\\.\pipe\`) blocks all functionality on Linux; must add Unix domain socket support with conditional path selection.

## Implications for Roadmap

Based on research, suggested phase structure for the Linux port:

### Phase 1: Platform Abstraction Layer (Foundation)

**Addresses:** Critical porting blockers (IPC, PTY binary, paths)

- Replace `PIPE_NAME` with conditional Windows/Linux path (Unix socket at `/tmp`)
- Add binary detection: `claude.exe` vs `claude`
- Create `platform.ts` module to encapsulate:
  - `getPipePath()`
  - `getClaudeBinary()`
  - `getConfigDir()` (XDG vs AppData)
- Add cleanup for Unix socket files on exit
- Update `rc.ts` and `daemon.ts` to use platform module

**Rationale:** Without this, nothing works on Linux. Must be first.

**Avoids:** Platform-specific code scattered throughout; later refactor pain.

---

### Phase 2: PTY and Signal Handling

**Addresses:** PTY backend differences, signal propagation, terminal state

- Test PTY spawn on Linux with mock Claude binary (or actual if available)
- Implement platform-specific signal forwarding in `rc.ts`
- Add `SIGPIPE` ignore handler on Linux
- Add daemon kill timeout to prevent orphaned processes
- Validate terminal restore cleanup
- Add `SIGTERM`/`SIGINT` handlers that properly cascade to PTY and daemon

**Rationale:** Core lifecycle management; build after IPC works. Prevents zombies and crashes.

**Detects:** Signal handling issues that only manifest under kill scenarios.

---

### Phase 3: File Watching Robustness

**Addresses:** inotify limits, truncation/rotation, edge cases

- Implement truncation detection in `handleFileChange` (add `if newSize < lastFileSize` branch)
- Add inotify `ENOSPC` error handling with user-friendly message
- Add polling fallback option (`usePolling: true`) as config escape hatch
- Document Linux prerequisite: `echo fs.inotify.max_user_watches=524288 | sudo tee -a /etc/sysctl.conf`
- Increase `awaitWriteFinish` stability if needed (test atomic writes)
- Add `fs.watchFile` fallback for edge cases? Not recommended, but document

**Rationale:** Current watcher works but lacks resilience; better to harden before testing at scale.

**Potential pitfall:** File truncation (e.g., transcript rotation) currently returns early without resetting `lastFileSize`; could cause missed events if file is replaced.

---

### Phase 4: Configuration and Environment

**Addresses:** Config paths, env validation, installation

- Implement XDG config directory (`~/.config/claude-remote/`) for Linux
- Add early validation of all required environment variables (both in `rc.ts` and `daemon.ts`)
- Add helpful error messages: "Set DISCORD_BOT_TOKEN in ~/.config/claude-remote/.env"
- Update `package.json`:
  - Add `engines: { node: ">=18" }`
  - Ensure shebang `#!/usr/bin/env node` present in source
- Document Linux installation paths (npm global prefix, permissions)
- Add `dotenv` support for `.env` file in config dir

**Rationale:** Ensures first-time user experience on Linux; prevents mystery crashes.

---

### Phase 5: Testing Strategy and CI

**Addresses:** Reproducible testing, multi-distro coverage, debugging

- Set up GitHub Actions matrix: `os: [ubuntu-latest, windows-latest]`
- Add Alpine build test (if supporting musl)
- Create integration test harness:
  - Mock Claude PTY (simple echo server) to test PTY I/O without real Claude binary
  - Mock Discord.js client to test provider logic
  - Use `tmux new-session` to provide TTY in CI
- Add `DEBUG=claude-remote:*` support via `debug` package
- Create manual test checklist (see research findings)
- Add unit tests for platform module (test pipe paths, binary detection)
- Add tests for truncation detection and inotify errors

**Rationale:** CI prevents regressions; debugging helps field issues; manual checklist validates end-to-end.

**Flags:**
- Integration tests may be flaky in CI due to TTY requirements → use `skip` on non-TTY
- Discord API mocking needed to avoid rate limits

---

### Phase 6: Packaging and Distribution

**Addresses:** Native module builds, installation experience, systemd service

- Document Linux prerequisites: `build-essential`, `python3`, `make`, `g++`
- Provide Dockerfile for reproducible builds (glibc-based)
- Provide systemd unit file example in README
- Test installation on clean Ubuntu VM (no global node_modules)
- Consider `npm pack` and test installation from tarball
- Add `.npmignore` to exclude unnecessary files (src, tests) if desired

**Rationale:** Users need smooth installation; native build failures are a common blocker.

---

### Phase 7: Polish and Observability

**Addresses:** Debugging, Unicode, edge cases

- Add `debug` logging throughout (already partially done with `console.log`)
- Refactor `console.log` → `debug('daemon')` etc.
- Test with Unicode output (emoji, CJK) to verify terminal width handling
- Add periodic temp file cleanup on startup (old files in `os.tmpdir()`)
- Add startup Node version check (fail fast if <18)
- Document WSL2 caveats: `usePolling: true` for mounted drives
- Document AppArmor/SELinux considerations if any

**Rationale:** After core works, improve maintainability and user experience.

---

## Phase Ordering Rationale

```
Platform Abstraction → PTY/Signals → File Watching → Config/Env → Testing → Packaging → Polish
```

**Dependencies:**
- Must modify IPC before anything else (`PIPE_NAME`)
- PTY changes depend on platform abstraction (binary name)
- File watching improvements don't depend on others but easier after PTY stable
- Config validation depends on knowing platform paths
- Testing depends on all features working
- Packaging depends on build success
- Polish is last (can ship without but support burden higher)

---

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | node-pty, chokidar, discord.js all cross-platform; documentation confirms |
| Features | HIGH | Feature set unchanged by port; just platform glue |
| Architecture | HIGH | IPC and pipeline design is sound; changes localized to edge interfaces |
| Pitfalls | HIGH | Identified through code review, platform knowledge, and CONCERNS.md; comprehensive |
| Testing strategy | MEDIUM | CI/TTY integration challenges may require iteration |
| User experience | HIGH | Configuration errors should be easy to fix |

**Gaps:**
- Actual testing requires Claude binary on Linux (not yet available). We must mock or wait for official Linux Claude Code release.
- Real-world inotify behavior on heavily-loaded systems not fully validated.
- Discord.js Linux-specific bugs unknown (if any); should be minimal.

---

## Research Flags for Phases

- **Phase 1 (Platform Abstraction):** Low risk, straightforward. No further research needed.
- **Phase 2 (PTY/Signals):** Medium confidence — actual behavior needs testing with a mock PTY or real Claude (if available). Flag: Verify signal propagation with `strace` on Linux.
- **Phase 3 (File Watching):** Medium confidence — truncation handling logic appears sound but not tested. Flag: Write integration test that truncates JSONL and verifies recovery.
- **Phase 4 (Config/Env):** High confidence — straightforward implementation.
- **Phase 5 (Testing/CI):** High confidence — standard patterns. May need research on CI TTY availability (GitHub Actions supports `tty: true`).
- **Phase 6 (Packaging):** Medium confidence — Alpine musl support unclear; may need testing on `node:20-alpine`.
- **Phase 7 (Polish):** Low confidence needed.

---

## Sources

- Codebase analysis: `rc.ts`, `daemon.ts`, `CONCERNS.md`, `package.json`
- Node.js documentation on `process.platform`, `child_process.fork()`, `net.Server.listen()` for Unix sockets
- node-pty documentation (Tyriar/node-pty) — known platform differences
- chokidar documentation — inotify and fsevents behavior
- discord.js guide — intents and gateway configuration
- Linux manual pages: `inotify(7)`, `forkpty(3)`, `signal(7)`

**No web search performed** due to API limitations; research based on code review and platform knowledge.

---

## Bottom Line

The Linux port is feasible with estimated 2-4 weeks of focused development, primarily around:
1. Adding platform conditional paths (2-3 days)
2. Testing PTY and signal handling (3-5 days, may wait for Claude Linux)
3. Harden file watching (2-3 days)
4. Config and environment (1-2 days)
5. CI setup and testing (2-3 days)
6. Documentation and polish (2-3 days)

**Biggest uncertainty:** Behavior of Claude Code binary on Linux (performance, PTY quirks, signal handling). Recommend early prototyping with a mock or beta binary if available.

**Risk:** Low-to-medium. Architecture is clean; changes are mostly surface-level compatibility. No major redesign needed.
