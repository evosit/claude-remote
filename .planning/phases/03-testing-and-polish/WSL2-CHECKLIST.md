# WSL2 Testing Checklist — Phase 3

## Prerequisites Specific to WSL2

- WSL2 installed and running (Ubuntu distribution recommended)
- Node.js 18+ installed inside WSL2 (`nvm` recommended)
- Claude Code CLI installed inside WSL2 (`curl -fsSL https://claude.ai/install.sh | bash`)
- Git installed
- If editing from Windows host (e.g., VS Code), ensure WSL2 integration is enabled

---

## Focus Areas for WSL2

1. **File watching**: When project files are located on the Windows filesystem (`/mnt/c/...`), `chokidar` may have higher latency or miss events. Prefer keeping the project inside WSL2's virtual filesystem (`~/project`) for best results. Test both scenarios if applicable.

2. **Terminal behavior**: PTY rendering, colors, and Unicode/emoji display should work correctly. Verify that prompts and output are not garbled.

3. **Socket cleanup**: After exiting WSL2 (shutdown), temporary Unix socket files in `/tmp` should be automatically cleaned by the WSL2 shutdown process. Verify no stale `.sock` files persist across reboots.

4. **Performance**: Observe any latency in message sync between CLI and Discord. WSL2 network bridging should be negligible but note if delays exceed expectations.

---

## Test Procedure

Follow the test cases from `TESTING.md` (TC1–TC5), with these additional notes:

### TC1–TC5: Standard Tests

Execute the same steps as in TESTING.md inside your WSL2 environment. Record results in the matrix.

### Additional WSL2-Specific Tests

#### A. Cross-filesystemEditing

If you use a Windows editor (VS Code with WSL extension):

1. Keep the project in a Linux-native path: `~/claude-remote`
   ```bash
   cd ~
   git clone <repo> claude-remote
   ```
2. Run `npm ci && npm run build && npm link`
3. Start `claude-remote -p "test"` in one terminal.
4. From VS Code on Windows, open `\\wsl$\Ubuntu\home\<user>\claude-remote`
5. Edit a file (e.g., add a comment) that would trigger JSONL changes. Observe if Discord sync picks up changes promptly.

**Expected:** Changes detected within 1–2 seconds. If delays exceed 5 seconds, note as a quirk.

#### B. Socket Persistence

1. Start a `claude-remote` session and note the socket path: `/tmp/claude-remote-<pid>.sock`
2. Exit the session normally (`Ctrl+C`).
3. Check: `ls /tmp/claude-remote-*.sock` — socket should be removed.
4. If you force-kill the terminal (e.g., close terminal window without proper shutdown), the socket might remain. This is expected but should be cleaned on WSL2 shutdown.
5. Shutdown WSL2 completely: `wsl --shutdown` (from Windows PowerShell or CMD).
6. Restart WSL2, check `/tmp` — no stale `.sock` files should remain.

**Expected:** Clean shutdown removes socket; WSL2 reboot clears any leftovers.

#### C. Unicode and Emoji

1. Run `claude-remote -p "Send emoji: 😀 👍 🎉"`
2. Verify that the emojis appear correctly in the Claude CLI and in Discord.
3. Also test CJK characters if available: `-p "Hello 你好 مرحبا"`

**Expected:** No garbled output; characters render correctly end-to-end.

#### D. File Watching from Windows Path (Optional Quirk Test)

1. Move the project to `/mnt/c/Users/<user>/claude-remote` (Windows filesystem)
2. Build and link again (may need to re-run `npm link`).
3. Start a session and edit files using a Windows-based editor (not WSL extension).
4. Observe if file changes are detected promptly.

**Expected:** Detection may be slower (up to several seconds) due to `inotify` limitations on mounted filesystems. Document observed latency.

---

## Results Table

| Test | Status | Notes |
|------|--------|-------|
| TC1 Help | ⬜ |      |
| TC2 Setup | ⬜ |      |
| TC3 Session | ⬜ |      |
| TC4 Toggle | ⬜ |      |
| TC5 Uninstall | ⬜ |      |
| A. Cross-FS Editing | ⬜ |      |
| B. Socket Cleanup | ⬜ |      |
| C. Unicode | ⬜ |      |
| D. Windows Path Quirk | ⬜ | (optional) |

---

## Reporting

Include results in `.planning/phases/03-testing-and-polish/TESTING_REPORT.md` under a "WSL2" section, summarizing:

- Any observed latency or file watching issues
- Whether the socket cleanup behaves acceptably
- Unicode rendering success
- Overall viability: "WSL2 fully supported" or "WSL2 supported with the following caveats: ..."

---

## Acceptance

If all critical tests (TC1–TC5) pass and any WSL2-specific quirks are documented (without blocking core functionality), WSL2 verification is considered complete.
