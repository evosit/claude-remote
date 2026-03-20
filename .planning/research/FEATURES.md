# Feature Research: Linux Support for claude-remote

**Domain:** Terminal-based remote control tool (Discord integration)
**Researched:** 2025-03-20
**Confidence:** HIGH

## Feature Landscape

### Table Stakes (Users Expect These)

Features users assume exist. Missing these = product feels incomplete on Linux.

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| **Basic PTY spawning** | Core functionality - must run Claude Code in terminal | LOW | `node-pty` supports Linux via forkpty. Need to remove Windows ConPTY-specific code and test forkpty behavior. |
| **Shell alias installation** | Users expect `claude` command to work | MEDIUM | Current code supports PowerShell/pwsh/Git Bash/CMD. Need to add: bash (~/.bashrc, ~/.bash_profile), zsh (~/.zshrc), fish (~/.config/fish/config.fish). |
| **Configuration persistence** | Settings must survive reboots | LOW | Already uses `~/.claude-remote/` which works on Linux. No changes needed. |
| **Discord bot connectivity** | Core integration must work | LOW | Pure Node.js, no platform-specific code. Works on Linux as-is. |
| **JSONL transcript watching** | Real-time sync requires file watching | LOW | `chokidar` works on Linux. No changes needed. |
| **IPC communication** | Parent-daughter process coordination | HIGH | **Critical**: Windows named pipes (`\\\\.\\pipe\\...`) need to be replaced with Unix domain sockets (`/tmp/claude-remote-<pid>.sock`) or Unix named pipes (FIFO). |
| **Self-update via npm** | Users need upgrade path | LOW | `npm install -g` works identically on Linux. The Windows-specific PATH check needs Linux equivalent. |
| **Signal handling (SIGTERM/SIGINT)** | Graceful shutdown | LOW | Already uses `process.on('SIGTERM')` which works on Linux. May need to adjust terminal restoration. |

### Differentiators (Competitive Advantage)

Features that set the product apart. Not required, but valuable on Linux.

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| **systemd --user service** | Auto-start daemon on login, automatic restarts on crash | HIGH | Optional but nice-to-have. Could enable "always-on" sync without manual terminal window. Requires separate service file installation. |
| **Shell completion scripts** | Tab completion for `/remote` commands | MEDIUM | bash-completion, zsh-completion, fish-completion packages. Not essential but improves UX. |
| **Desktop notifications** | Notify on tool approval needed | MEDIUM | Requires desktop environment integration (libnotify). May not work on headless servers. Conditional implementation. |
| **Multiple shell profile detection** | Support ~/.profile, ~/.bash_profile, ~/.zprofile, environment-specific configs | MEDIUM | Linux has more shell startup files than Windows. Need comprehensive detection to avoid duplicate installs. |
| **Package manager integration** | Install via apt/yum/brew in addition to npm | HIGH | Allows broader distribution but complex to maintain. Defer to post-launch. |

### Anti-Features (Commonly Requested, Often Problematic)

Features that seem good but create problems on Linux.

| Feature | Why Requested | Why Problematic | Alternative |
|---------|---------------|-----------------|-------------|
| **Global service (system-wide)** | "All users on the machine can use it" | Requires root, security risk, multi-user confusion (single Discord bot token) | Stick to `--user` services or per-terminal model |
| **Automatic PATH modification** | "Make it Just Work™" | Tampering with shell profile files is risky; could break user's shell if malformed | Prompt user and show exact commands; offer `--dry-run` |
| **Support for WSL** | "I use Windows Subsystem for Linux" | WSL has different PTY behavior, named pipe compatibility issues, and interop layer complexity | Detect WSL and provide special instructions; may be v2+ |
| **Root/capabilities escalation** | "Need to bind to privileged ports" | claude-remote doesn't need networking beyond Discord; security anti-pattern | Never require root; use user-level permissions only |

## Feature Dependencies

```
Linux Support (v1)
├─ requires ──► PTY spawning (node-pty forkpty)
├─ requires ──► IPC transport (Unix sockets/FIFO)
├─ requires ──► Shell alias installation (bash/zsh/fish)
└─ requires ──► Terminal restoration (non-Windows)

systemd --user service (v1.x)
└─ depends on ─► Linux Support stable

Shell completion (v1.x)
└─ depends on ─► Linux Support stable

Desktop notifications (v2+)
└─ depends on ─► systemd service OR long-running daemon pattern
```

### Dependency Notes

- **IPC transport**: This is the hardest dependency. Windows uses named pipes with Win32 API path syntax (`\\.\pipe\name`). Linux must use Unix domain sockets (`/tmp/claude-remote-<pid>.sock`) or POSIX FIFOs. The protocol (JSON messages) stays identical, only transport layer changes.
- **Shell alias**: Must happen after configuration is saved. Shell detection needs to be comprehensive to avoid missing user's preferred shell.
- **Terminal restoration**: Windows has `win32-input-mode` ConPTY bug. Linux uses different TTY attributes; need to ensure `setRawMode(false)` is sufficient across terminal emulators.

## MVP Definition

### Launch With (v1 Linux)

Minimum viable product — what's needed to validate Linux support.

- [ ] **Cross-platform PTY layer** - Detect platform, use appropriate node-pty backend (ConPTY vs forkpty)
- [ ] **Unix socket IPC** - Replace Windows named pipes with Unix domain sockets
- [ ] **Shell alias for common shells** - bash (~/.bashrc), zsh (~/.zshrc), fish (~/.config/fish/config.fish)
- [ ] **Platform conditionals** - Remove Windows-specific terminal restoration code from non-Windows paths
- [ ] **Test matrix** - Verified on Ubuntu/Debian, Fedora/RHEL, Arch (common distros)
- [ ] **Documentation** - Linux-specific setup instructions, troubleshooting TTY issues

### Add After Validation (v1.x)

Features to add once core is working.

- [ ] **Fish shell completions** - Tab completion for `/remote` commands
- [ ] **Path modification detection** - Check if `~/.local/bin` is in PATH after CMD shim install (Linux equivalent)
- [ ] **Better error messages** - Detect missing node-pty dependencies (libutil-dev, etc.)
- [ ] **systemd --user unit** - Optional service file installation for "always-on" usage

### Future Consideration (v2+)

Features to defer until product-market fit is established.

- [ ] **Desktop notifications** - libnotify integration for tool approval alerts
- [ ] **WSL special support** - May need hybrid named pipe / socket approach
- [ ] **Package manager distribution** - apt, yum, Homebrew Linuxbrew formulas
- [ ] **Multiple concurrent users** - Multi-user server installation (complex permission model)

## Feature Prioritization Matrix

| Feature | User Value | Implementation Cost | Priority |
|---------|------------|---------------------|----------|
| Cross-platform PTY | HIGH | LOW | P1 |
| Unix socket IPC | HIGH | HIGH | P1 |
| Shell alias (bash/zsh/fish) | HIGH | MEDIUM | P1 |
| Terminal restoration fix | HIGH | LOW | P1 |
| systemd --user service | MEDIUM | HIGH | P2 |
| Shell completions | LOW | MEDIUM | P3 |
| Desktop notifications | LOW | MEDIUM | P3 |
| Package manager distro | LOW | HIGH | P4 |

**Priority key:**
- P1: Must have for launch
- P2: Should have, add when possible
- P3: Nice to have, future consideration
- P4: Defer until stable

## Competitor Feature Analysis

| Feature | Competitor A (N/A) | Competitor B (N/A) | Our Approach |
|---------|-------------------|-------------------|--------------|
| Platform support | No known Linux competitors in this niche | N/A | First-to-market Linux remote control for Claude Code |
| Shell integration | N/A | N/A | Comprehensive: bash, zsh, fish; follow each shell's standard profile conventions |
| Service management | N/A | N/A | Optional systemd --user, not forced; keep simple terminal-based model as default |

## Sources

- **Codebase reviewed**: `/home/dacineu/dev/dev-nodejs/claude-remote/src/cli.ts`, `rc.ts`, `daemon.ts`, `utils.ts`
- **node-pty documentation**: https://github.com/microsoft/node-pty (cross-platform PTY library)
- **Linux shell profile files**: bash(1), zsh(1), fish(1) man pages (standard conventions)
- **systemd user services**: https://www.freedesktop.org/software/systemd/man/systemd.user.html
- **Unix domain sockets**: https://man7.org/linux/man-pages/man7/unix.7.html
- **Discord.js**: Pure Node.js, no platform-specific dependencies identified

## Open Questions

1. **Socket path lifetime**: Should we clean up Unix socket files on exit? Windows named pipes auto-clean but Unix sockets may persist. Need robust cleanup logic.
2. **Socket location**: `/tmp` (standard but world-writable, security consideration) vs `XDG_RUNTIME_DIR` (per-user, cleaner) vs config dir (persistent). Recommend `/tmp` for simplicity, cleanup on exit.
3. **WSL support**: Should we detect WSL and provide special instructions? WSL1 vs WSL2 have different IPC capabilities. Defer to v1.x.
4. **Hot-reload across fork**: `fs.watchFile` works on Linux but may have inotify limits. Should we provide tuning guidance? Low priority.

---

*Feature research for: Linux support for claude-remote*
*Researched: 2025-03-20*
