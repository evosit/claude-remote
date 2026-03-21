# WSL2 Manual Testing Checklist

## Prerequisites Specific to WSL2

- **Node.js** installed in WSL2 environment
- **Claude Code CLI** installed and working in WSL2
- **Windows host** has Discord access (web or desktop app)
- Network connectivity between WSL2 and Discord servers

---

## Focus Areas

### 1. File Watching
When using a Windows editor (VS Code, etc.) editing files under `/mnt/c/...`, inotify events may be delayed or missed. Verify:

- [ ] JSONL file changes in `~/.claude/claude-remote/sessions/` are detected promptly when editing from Windows editor (via `/mnt/c/...` path)
- [ ] JSONL file changes are detected when editing from Linux-side editor (e.g., vim in WSL2)
- [ ] No significant lag (>2 seconds) between file save and daemon reaction

### 2. Terminal Behavior
- [ ] PTY rendering: text appears correctly, no garbled characters
- [ ] Colors: ANSI colors render as expected (if used by Claude)
- [ ] Unicode/emoji: Emojis and non-ASCII characters display correctly in both terminal and Discord

### 3. Socket Cleanup
- [ ] After exiting WSL2 (`wsl --shutdown` or close terminal), `/tmp/claude-remote-*.sock` files are cleaned up
- [ ] On restarting WSL2, no stale socket files remain from previous session
- [ ] No "socket in use" errors on subsequent runs

---

## Test Procedure

Follow the test cases from **TESTING.md**, with these WSL2-specific notes:

### TC1: Help Output
Same as standard. Verify `claude-remote help` works in WSL2.

### TC2: Setup Wizard
Run `claude-remote setup` in WSL2. Complete configuration. Note any Windows path-related issues (should be none as config is in Linux home).

### TC3: Basic Session
```bash
claude-remote -p "hello from WSL2"
```
Observe:
- Daemon logs in `~/.claude/claude-remote/daemon.log`
- Socket file in `/tmp`
- Discord message appears
- Response in terminal

### TC4: Status Toggle
Within a session, test `/remote off` and `/remote on`. Verify Discord status updates.

### TC5: Uninstall
Run `claude-remote uninstall`. Ensure no crashes; all components removed.

---

## Results Table

| Test Case | Status | Notes |
|-----------|--------|-------|
| TC1 Help | ⬜ | |
| TC2 Setup | ⬜ | |
| TC3 Basic -p | ⬜ | |
| TC4 Status Toggle | ⬜ | |
| TC5 Uninstall | ⬜ | |
| File Watching (Windows editor) | ⬜ | |
| File Watching (Linux editor) | ⬜ | |
| Socket Cleanup | ⬜ | |

---

## Additional Observations

Document any quirks:
- Permission errors
- Path handling differences
- Performance characteristics
- Build issues specific to WSL2
- Integration with Windows tools (e.g., Discord desktop app vs web)

---

**End of WSL2-CHECKLIST.md**
