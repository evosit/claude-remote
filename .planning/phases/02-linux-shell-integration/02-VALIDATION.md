---
phase: 2
slug: linux-shell-integration
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-21
---

# Phase 2 — Validation Strategy

Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Manual verification (no automated test suite) |
| **Config file** | none — Phase 2 focuses on CLI output and file modifications |
| **Quick run command** | N/A (manual) |
| **Full suite command** | N/A (manual) |
| **Estimated runtime** | ~15 minutes (manual Linux testing) |

---

## Sampling Rate

- **After every task commit:** Manual code inspection (grep checks)
- **After every plan wave:** Manual integration test on Linux VM
- **Before `/gsd:verify-work`:** Full manual checklist must pass
- **Max feedback latency:** N/A (manual)

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 02-01 | 01 | 1 | FR-4, UX-2 | manual | See P2.1 checks | N/A | ⬜ pending |
| 02-02 | 01 | 1 | FR-1, UX-3 | manual | See P2.2 checks | N/A | ⬜ pending |
| 02-03 | 01 | 1 | FR-1, FR-5 | manual | See P2.3 checks | N/A | ⬜ pending |
| 02-04 | 01 | 1 (stretch) | NFR-1 | manual | See P2.4 checks | N/A | ⬜ pending |

---

## Wave 0 Requirements

- [ ] No automated test infrastructure needed — Phase 2 is manual verification phase
- [ ] Existing codebase compiles: `npm run build` (verification prerequisite)

*"Existing infrastructure covers all phase requirements."*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Shell detection uses `$SHELL` and prompts if multiple | FR-4, UX-2 | Requires interactive setup run on Linux | 1. Set `SHELL=/bin/zsh`<br>2. Ensure `.bashrc` and `.zshrc` exist<br>3. Run `claude-remote setup`<br>4. Observe prompt: "Detected shells: zsh" or if both files present, multiselect prompt<br>5. Verify only selected profiles modified |
| PATH error message helpful | UX-3 | Visual inspection of error output | 1. Rename/move `claude` binary temporarily<br>2. Run `claude-remote -p "test"`<br>3. Observe error: "Claude binary 'claude' not found in PATH" with install URL<br>4. Exit code = 1 |
| `.env` file loads credentials | FR-1, FR-5 | Requires file I/O and daemon behavior | 1. Create `~/.config/claude-remote/.env` with valid `DISCORD_BOT_TOKEN`, `GUILD_ID`, `CATEGORY_ID`<br>2. Unset those env vars in shell<br>3. Run `claude-remote -p "test"`<br>4. Daemon starts and connects to Discord (no config errors) |
| systemd service installs and starts (optional) | NFR-1 | Requires systemd environment | 1. On Linux with systemd --user enabled<br>2. Run `claude-remote setup`, enable systemd option<br>3. Verify unit file written to `~/.config/systemd/user/claude-remote.service`<br>4. Run `systemctl --user status claude-remote` shows active<br>5. Reboot, check service started automatically |

---

## Integration Test Checklist (Pre-Completion)

Before marking Phase 2 complete, run on Linux (Ubuntu/Fedora/WSL2):

1. [ ] `npm run build` succeeds
2. [ ] `claude-remote setup` runs without errors
3. [ ] Shell detection: respects `$SHELL`, falls back to file existence
4. [ ] If multiple shells detected: prompt appears with sensible defaults
5. [ ] Aliases install only to selected profiles (not all)
6. [ ] Idempotency: running setup twice doesn't duplicate alias lines
7. [ ] PATH verification: missing `claude` prints clear error with install URL
8. [ ] `.env` loading: credentials read from `~/.config/claude-remote/.env` without exported env
9. [ ] systemd (if implemented): service installs, enables, starts, persists after reboot
10. [ ] Uninstall removes all installed components (aliases, config, optional systemd unit)

---

## Validation Sign-Off

- [x] All tasks have manual verification steps defined (Wave 0 not applicable)
- [x] No 3 consecutive tasks without verification (all tasks covered)
- [x] Wave 0: build prerequisite established
- [x] No watch-mode flags
- [x] Feedback latency acceptable (manual ~15 min)
- [ ] `nyquist_compliant: true` set in frontmatter after task implementation

**Approval:** pending (after tasks completed and manual tests pass)

