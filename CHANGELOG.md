# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [2.1.0] - 2026-03-22

### Added
- Linux support for Ubuntu, Fedora, Alpine, and WSL2
- Platform abstraction layer (`src/platform.ts`) with Unix sockets on Linux
- Shell integration for bash, zsh, and fish with marker-based idempotent installation
- `.env` file support for credentials (`~/.config/claude-remote/.env`)
- Debug logging via `DEBUG=claude-remote:*`
- Proactive error handling for config dir, status flag, and session files
- WSL2 testing checklist and multi-distro testing guide
- Alpine Linux compatibility documentation

### Changed
- Configuration directory remains `~/.claude/claude-remote/` for cross-platform consistency

### Fixed
- Daemon auto-restart bug that caused bot to stay online after session exit. The daemon now properly shuts down when the parent process exits cleanly, preventing orphaned bots.

### Known Issues
- WSL2: file watching may have delays when editing from Windows editors
- Alpine Linux requires manual build dependencies (see COMPATIBILITY.md)
- macOS untested (may work but not officially supported)

---

## [2.0.0] - 2026-03-21

### Added
- Full Linux support (Ubuntu, Fedora, Alpine, WSL2)
- Cross-platform IPC (Unix sockets on Linux, named pipes on Windows)
- Shell alias installation for bash/zsh/fish
- Comprehensive test matrix and CI for Ubuntu
- Debug logging infrastructure
- Improved error messages and UTF-8 locale enforcement

### Changed
- No breaking changes for Windows users; Linux code paths are conditional

### Known Issues
- WSL2 file watching quirks
- Alpine requires build-essential and python3

---

## [Unreleased]

### Added
- **Security: Pairing code authorization** – Each Discord remote session generates a unique 6-digit pairing code displayed in the terminal. Users must enter `/auth <code>` in Discord to authorize control. The code expires after 60 seconds and is single-use.
- `/auth` slash command to verify the pairing code.
- Rate limiting: max 5 attempts per 10-minute window to prevent brute force.
- All slash commands and Discord button interactions now require prior authorization.

### Changed (Breaking)
- Public bots are no longer open for control by any Discord user. Authorization via terminal pairing code is mandatory. Existing deployments will need to re-authorize when upgrading.

### Fixed
- Daemon auto-restart bug that caused bot to stay online after session exit.

---

## [1.2.0] - 2025-xx-xx

Initial public release (Windows only).
