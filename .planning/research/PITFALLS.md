# Domain Pitfalls: Porting Windows PTY-based Discord Bridge to Linux

**Project:** claude-remote
**Researched:** 2026-03-20
**Focus:** Linux porting challenges for PTY-based Discord bot

## Critical Pitfalls

### Pitfall 1: Windows-Specific Named Pipe Path Format

**What goes wrong:** `src/rc.ts:12` uses Windows named pipe format:
```typescript
const PIPE_NAME = `\\\\.\\pipe\\claude-remote-${process.pid}`;
```
This absolute Windows path won't work on Linux. Linux uses Unix domain sockets at filesystem paths like `/tmp/claude-remote-<pid>.sock`.

**Why it happens:** The Windows API uses special `\\.\pipe\` namespace. Linux socket paths are regular filesystem paths subject to permissions.

**Severity:** Critical (blocks all functionality)

**Consequences:**
- Named pipe server fails to start on Linux
- Client connections impossible
- Entire IPC mechanism breaks

**Detection:** Attempt to start on Linux → `EADDRNOTAVAIL` or `EINVAL` errors from `net.Server.listen()`.

**Mitigation:**
```typescript
const PIPE_NAME = process.platform === "win32"
  ? `\\\\.\\pipe\\claude-remote-${process.pid}`
  : `/tmp/claude-remote-${process.pid}.sock`;

// Also: cleanup socket file on exit (Linux)
if (process.platform !== "win32") {
  try { fs.unlinkSync(PIPE_NAME); } catch { /* ignore */ }
}
```

**References:**
- Node.js `net.Server.listen()` documentation for Unix socket paths
- Existing code: `rc.ts:12`, `daemon.ts:177` (fork IPC)

---

### Pitfall 2: node-pty Platform Implementation Differences

**What goes wrong:** The code spawns `claude.exe` with:
```typescript
const proc = pty.spawn(CLAUDE_BIN, process.argv.slice(2), {
  name: "xterm-color",
  cols: process.stdout.columns || 120,
  rows: process.stdout.rows || 30,
  cwd: projectDir,
  env: process.env as Record<string, string>,
});
```

On Linux:
1. **Binary name:** `"claude.exe"` won't exist; needs `"claude"` or detection
2. **PTY backend:** Linux uses `forkpty()` (pty module) vs Windows ConPTY
3. **Terminal capabilities:** `xterm-color` may differ in support
4. **Signal handling:** Windows ConPTY has different signal behavior

**Why it happens:** node-pty uses different native backends:
- Windows: ConPTY (Windows 10+ pseudo console) or legacy Win32 PTY
- Linux/macOS: `forkpty()` from `util-linux`/BSD

**Severity:** Critical (core functionality)

**Consequences:**
- `pty.spawn()` throws `ENOENT` if binary not found
- Different terminal behavior (colors, special keys)
- Signal propagation issues (SIGINT, SIGTERM)
- Potential zombie processes if cleanup differs

**Detection:**
- Linux start: `Error: spawn claude.exe ENOENT`
- Missing signal forwarding: Ctrl+C doesn't reach Claude
- Terminal state not restored properly on exit

**Mitigation:**

1. **Binary detection:**
```typescript
const CLAUDE_BIN = process.platform === "win32" ? "claude.exe" : "claude";

// Or try both:
function findClaudeBinary(): string {
  const candidates = process.platform === "win32"
    ? ["claude.exe", "claude"]
    : ["claude", "claude.exe"];
  for (const bin of candidates) {
    try {
      // Check if binary exists in PATH
      if (whichSync(bin)) return bin;
    } catch {}
  }
  throw new Error("Could not find Claude binary in PATH");
}
```

2. **Signal handling differences:**
```typescript
// On Linux, need to forward signals to PTY child explicitly
process.on('SIGINT', () => {
  if (process.platform !== 'win32') {
    proc.kill('SIGINT');
  } else {
    proc.kill(); // Windows handles differently
  }
});

// Also: ptyspawn on Linux automatically forwards signals to child
// But Windows ConPTY doesn't — need to send via proc.write()
```

3. **Terminal restore cleanup:**
```typescript
function restoreTerminal() {
  if (process.stdin.isTTY) process.stdin.setRawMode(false);
  process.stdin.unref();

  // Windows: ConPTY leaves win32-input-mode enabled
  if (process.platform === "win32") {
    process.stdout.write("\x1b[?9001l");
  }
}
```
Linux doesn't need the escape sequence, but doesn't hurt.

**Linux-specific testing:**
- Test with real `claude` binary (if available) or mock PTY
- Verify `SIGTERM`, `SIGINT`, `SIGHUP` handling
- Check terminal state after crash (should be clean)

**References:**
- node-pty README: Platform differences section
- Code at `rc.ts:45-75` (spawn and signal handling)

---

### Pitfall 3: File Watching with chokidar on Linux

**What goes wrong:** Current code uses:
```typescript
watcher = chokidar.watch(jsonlPath, {
  persistent: true,
  awaitWriteFinish: { stabilityThreshold: 200, pollInterval: 50 },
});
```

On Linux:
1. **inotify limits:** Default max watches 8192 per user; can hit `ENOSPC`
2. **Event coalescing:** inotify may merge events differently than fsevents
3. **File truncation/rotation:** In-place truncation (`> file`) may not trigger events reliably
4. **Permission issues:** Watching files owned by other users fails with `EACCES`

**Why it happens:**
- Linux uses inotify kernel API with hardcoded limits
- inotify doesn't always emit `rename` for atomic writes; may emit `close_write` only
- The code expects append-only writes; truncation breaks `lastFileSize` tracking

**Severity:** High (watch failures cause sync to break silently)

**Consequences:**
- JSONL changes not detected → Discord out of sync
- Memory leak if watcher errors unhandled
- Infinite loop if file truncated/reset

**Detection:**
- Console: `[daemon] Watcher error: Error: ENOSPC: System limit for number of file watchers reached`
- Discord not updating when JSONL grows
- Logs show repeated re-open attempts

**Mitigation:**

1. **Handle inotify limit errors:**
```typescript
watcher.on('error', (err) => {
  if (err.code === 'ENOSPC') {
    console.error('[daemon] inotify watch limit reached. Increase with:');
    console.error('  echo fs.inotify.max_user_watches=524288 | sudo tee -a /etc/sysctl.conf && sudo sysctl -p');
    process.exit(1);
  }
  console.error('[daemon] Watcher error:', err);
});
```

2. **Detect file truncation:**
```typescript
async function handleFileChange(filePath: string) {
  const stat = await fs.stat(filePath);
  const newSize = stat.size;

  // File truncated or replaced — reset tracking
  if (newSize < lastFileSize) {
    console.log('[daemon] File truncated, resetting position');
    lastFileSize = 0;
    // Optionally: clear dedup sets? Depends on use case
  }

  // Read deltas from lastFileSize to newSize
  const fd = await open(filePath, 'r');
  if (newSize > lastFileSize) {
    const buf = Buffer.alloc(newSize - lastFileSize);
    await fd.read(buf, 0, buf.length, lastFileSize);
    // ... process
  }
  lastFileSize = newSize;
  await fd.close();
}
```
Current code (`daemon.ts:562-578`) does this! Good. But ensure it handles `newSize < lastFileSize` case (rewind) — currently it returns early, not resetting.

3. **Increase production limits:**
Document in README:
```bash
# Increase inotify watches (Linux only)
echo fs.inotify.max_user_watches=524288 | sudo tee -a /etc/sysctl.conf
sudo sysctl -p
```

4. **Polling fallback (last resort):**
```typescript
watcher = chokidar.watch(jsonlPath, {
  usePolling: true,  // If inotify unreliable
  interval: 1000,
  persistent: true,
});
```
Performance impact but more reliable.

**Testing on Linux:**
- Simulate truncation: `echo "" > transcript.jsonl`
- Simulate deletion: `rm transcript.jsonl` (inotify emits `unlink`)
- Test many concurrent watchers: `for i in {1..10000}; do touch file_$i; done`

**References:**
- chokidar README: "Issues & Solutions" section on `ENOSPC`
- Current implementation: `daemon.ts:511-520`, `562-578`

---

### Pitfall 4: Signal Handling Differences

**What goes wrong:** Code registers:
```typescript
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
```

On Linux:
1. **Process groups:** Daemon forked from `rc.ts` might not receive signals if in separate process group
2. **SIGPIPE:** Default action terminates process; if pipe broken, daemon crashes
3. **Signal availability:** Windows lacks `SIGHUP`, `SIGQUIT`, `SIGPIPE` behavior differs

**Why it happens:**
- Linux sends signals to process groups by default (e.g., `kill -TERM -pid`)
- Forked child processes inherit signal handlers but can be in different group
- Broken pipe (reading/writing to closed socket) raises `SIGPIPE` on Linux; Windows ignores

**Severity:** High (orphaned processes, crashes)

**Consequences:**
- Daemon survives parent exit → orphaned → zombies → Discord bot keeps running
- PTY processes left behind
- `SIGPIPE` crash on Linux if writing to closed socket

**Detection:**
- `ps aux | grep claude-remote` shows orphaned daemons
- `kill -TERM <parent>` doesn't stop daemon
- Core dumps or sudden exits with "Broken pipe" errors

**Mitigation:**

1. **Ensure daemon receives signals:**
```typescript
// In daemon spawn (rc.ts:177):
daemon = fork(daemonPath, [], {
  env: { /* ... */ },
  stdio: ["pipe", "pipe", "pipe", "ipc"],
  detached: false,  // Default — inherits process group
});

// If you need signal propagation:
process.on('SIGTERM', () => {
  daemon?.kill('SIGTERM');
  process.exit(0);
});
```
Current code at `rc.ts:243-254` does this — Good. But verify that forked daemon doesn't create new process group. If it does, add:
```typescript
process.setGroupLeader(null);  // Keep in parent's group (Linux only)
```

2. **Handle SIGPIPE:**
```typescript
// Ignore SIGPIPE on Linux to avoid crashes from broken sockets
if (process.platform !== 'win32') {
  process.on('SIGPIPE', () => {}); // Ignore
}
```

3. **Daemon cleanup:**
Current `rc.ts:227-232` `stopDaemon()` kills daemon with `SIGTERM` — Good. But add timeout:
```typescript
function stopDaemon() {
  if (!daemon) return;
  daemon.kill('SIGTERM');
  // Wait for exit or force kill after 5s
  const timeout = setTimeout(() => {
    if (daemon) daemon.kill('SIGKILL');
  }, 5000);
  daemon.once('exit', () => { clearTimeout(timeout); });
  daemon = null;
  setStatusFlag(false);
}
```

**Testing:**
- Start daemon, `kill -TERM <parent-pid>` → daemon exits
- Start daemon, close Discord connection (simulate) → daemon doesn't crash
- `kill -HUP <daemon-pid>` → should be handled or ignored (not crash)

---

### Pitfall 5: Path Separator and Case Sensitivity

**What goes wrong:** Code uses path operations:
```typescript
path.join(CONFIG_DIR, "sessions.json");
path.join(os.homedir(), ".claude-remote", "daemon.log");
```

**Issues on Linux:**
1. **Case sensitivity:** `./Claude` ≠ `./claude`
2. **Home directory:** `os.homedir()` returns `/home/user` not `C:\Users`
3. **Permission paths:** Config dir at `~/.config` vs `%APPDATA%` on Windows
4. **Executable lookup:** `which` vs `where`

**Where it appears:**
- `rc.ts:188` — log path
- `daemon.ts:906-927` — sessions file
- `utils.ts:resolveJSONLPath()` — likely hardcoded paths

**Severity:** Medium (breaks config persistence)

**Consequences:**
- Config files read from wrong locations
- Logs written to unexpected paths
- Sessions not remembered across restarts
- Claude binary not found

**Mitigation:**

1. **Use OS-appropriate config location:**
```typescript
import { homedir } from 'node:os';
import { join } from 'node:path';

const CONFIG_DIR = process.platform === 'win32'
  ? join(homedir(), 'AppData', 'Roaming', 'claude-remote')
  : join(homedir(), '.config', 'claude-remote');  // XDG
```
Check if existing code already does this in `utils.ts`.

2. **Binary lookup:**
Use `which` on Linux: `which claude`
```typescript
import which from 'which';

const claudePath = which.sync(CLAUDE_BIN, { nobuiltin: true });
if (!claudePath) throw new Error('Claude not found in PATH');
```

3. **Normalize paths before storage:**
Store `sessionId → channelId` with consistent separators. Use `path.normalize()`.

**Testing:**
- Start bot on fresh Linux install → config created at `~/.config/claude-remote/`
- Move project to lowercase path → still works
- Path with spaces: `~/my projects/test` → works

---

## High-Risk Pitfalls

### Pitfall 6: Line Endings and Text Encoding

**What goes wrong:** JSONL file consumption at `daemon.ts:431-432`:
```typescript
const raw = await readFile(jsonlPath, "utf-8");
const allMessages = parseJSONLString(raw);
```

If the JSONL has Windows CRLF (`\r\n`), `split("\n")` at `daemon.ts:580` leaves `\r` at end of lines, causing `JSON.parse` failures.

**Why it happens:** Claude Code on Windows writes with `\r\n` by default (depending on IDE settings). Reading on Linux must handle both.

**Severity:** Medium (can break parsing silently)

**Consequences:**
- Lines fail to parse → messages dropped → Discord missing content
- `JSON.parse` throws → caught and skipped → silent data loss

**Detection:** Error logs: `[daemon] No existing JSONL to replay (or error):` with `SyntaxError: Unexpected token` showing `\r` in message.

**Mitigation:**

```typescript
function parseJSONLString(raw: string): JSONLMessage[] {
  return raw.split(/\r?\n/).filter(Boolean).map(line => {
    try {
      return JSON.parse(line) as JSONLMessage;
    } catch (err) {
      console.error('[daemon] Failed to parse JSONL line:', line.substring(0, 100));
      return null;
    }
  }).filter((msg): msg is JSONLMessage => msg !== null);
}
```
Ensure `parseJSONLString` already does this. Check `utils.ts` or `jsonl-parser.ts`.

Also, when writing files (sessions.json), always use `JSON.stringify(..., null, 2)` which produces `\n` only. Node.js `fs.writeFileSync` with "utf-8" doesn't add `\r`.

**Testing:**
- Create test JSONL with CRLF on Windows, copy to Linux
- Run daemon → should still parse correctly
- Unit test: `parseJSONLString("{\"a\":1}\r\n{\"b\":2}\r\n")` returns 2 messages

---

### Pitfall 7: Discord.js Intents and Gateway Configuration

**What goes wrong:** Code at `daemon.ts:106-131`:
```typescript
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
  // ...
});
```

**Linux doesn't change this, but deployment does:** On Linux, you might run as systemd service with different environment, causing:
- Missing `DISCORD_BOT_TOKEN` env var
- `MessageContent` intent not enabled in Discord Developer Portal
- Privileged intents (`GuildMembers`) missing when needed

**Why it happens:** Linux deployments often use environment files or systemd, and developers forget to enable intents in portal after bot approval.

**Severity:** High (bot fails to start)

**Consequences:**
- Bot connects but can't read messages → sync broken
- Bot crashes on startup with "Missing Access" or "Unknown Intent"

**Detection:** Startup logs:
```
[daemon] Discord bot logged in
[daemon] Error: Unknown intent
```
Or: Bot appears online but doesn't post messages.

**Mitigation:**

1. **Validate configuration early:**
```typescript
const requiredIntents = [
  GatewayIntentBits.Guilds,
  GatewayIntentBits.GuildMessages,
  GatewayIntentBits.MessageContent,
];

// Optionally add MessageContent if privileged and needed
if (!process.env.DISCORD_MESSAGE_CONTENT_INTENT_ENABLED) {
  console.warn('[daemon] MessageContent intent may be disabled in portal');
}

const client = new Client({
  intents: requiredIntents,
  // ...
});
```

2. **Document prerequisites:**
In README for Linux users:
```
Prerequisites:
1. Enable these intents in Discord Developer Portal:
   - MESSAGE CONTENT INTENT (required)
   - SERVER MEMBERS INTENT (optional, if using member features)
2. Invite bot with scope: bot, applications.commands
3. Set environment variables:
   DISCORD_BOT_TOKEN=...
   DISCORD_GUILD_ID=...
   DISCORD_CATEGORY_ID=...
```

3. **Production env validation:**
Add startup check:
```typescript
if (!process.env.DISCORD_BOT_TOKEN?.startsWith('MT')) {
  console.error('[daemon] Invalid DISCORD_BOT_TOKEN format');
  process.exit(1);
}
```

**Testing:**
- Deploy with empty env → fails fast with clear error
- Deploy with wrong intent enabled → catch `Events.Error` and log

---

### Pitfall 8: File Permissions and Execution Rights

**What goes wrong:** After deployment:
```bash
npm install -g @hoangvu12/claude-remote
```

On Linux:
1. **Global install permissions:** npm global prefix often `/usr/local` requiring `sudo`
2. **Shebang line:** `#!/usr/bin/env node` must exist and be valid
3. **Executable bit:** Binaries need `+x` permission
4. **Config dir write:** `~/.config/claude-remote/` needs user write access (usually OK)

**Severity:** Medium (prevents installation)

**Consequences:**
- `claude-remote: command not found`
- `EACCES: permission denied` when writing config
- Daemon can't write log file

**Detection:**
```bash
$ claude-remote --version
bash: claude-remote: command not found

# or:
Error: EACCES: permission denied, mkdir '/home/user/.config/claude-remote'
```

**Mitigation:**

1. **Package properly:** Ensure `package.json` `bin` field correct and `prepublishOnly` compiles TypeScript to `dist/`.

2. **Document installation options:**
```markdown
## Installation on Linux

**Option A: npm with user install (no sudo)**
```bash
npm install -g --prefix ~/.npm-global @hoangvu12/claude-remote
export PATH=~/.npm-global/bin:$PATH
```
**Option B: Local install**
```bash
npm install @hoangvu12/claude-remote
npx claude-remote --help
```
```

3. **Shebang check:** Ensure built `dist/cli.js` starts with:
```javascript
#!/usr/bin/env node
```
TypeScript compiler (`tsc`) preserves shebang if present in source. Add to `src/cli.ts`:
```typescript
#!/usr/bin/env node
```

4. **Post-install script?** Not needed for pure JS, but could create config dir:
```json
"scripts": {
  "postinstall": "mkdir -p ~/.config/claude-remote || true"
}
```
Not cross-platform; better to create on first run.

**Testing:**
- Fresh Linux VM, no global node_modules → install works
- Run as non-root → writes to `~/.config` succeed
- `which claude-remote` returns correct path

---

### Pitfall 9: Environment Variable Propagation

**What goes wrong:** Code accesses:
```typescript
process.env.DISCORD_BOT_TOKEN
process.env.DISCORD_GUILD_ID
process.env.DISCORD_CATEGORY_ID
```

On Linux:
1. **Systemd services:** Need `EnvironmentFile=` or `Environment=` in unit file
2. **Shell differences:** `export VAR=value` vs `set VAR=value` (Windows)
3. **No User Profile:** `~/.profile` not sourced for non-login shells
4. **sudo:** `sudo claude-remote` loses user's env

**Severity:** Medium (config incomplete)

**Consequences:**
- Daemon exits with "Missing DISCORD_BOT_TOKEN"
- Bot runs in non-interactive shell without env

**Detection:** Startup logs:
```
[daemon] Missing DISCORD_BOT_TOKEN, DISCORD_GUILD_ID, or DISCORD_CATEGORY_ID
```

**Mitigation:**

1. **Validate all required env vars upfront:**
```typescript
const required = ['DISCORD_BOT_TOKEN', 'DISCORD_GUILD_ID', 'DISCORD_CATEGORY_ID'];
for (const varName of required) {
  if (!process.env[varName]) {
    console.error(`[daemon] Missing required environment variable: ${varName}`);
    process.exit(1);
  }
}
```
Already partly done at `daemon.ts:101-104` — Good. But fails after daemon fork. Should check earlier in `rc.ts` before spawning daemon? No, daemon needs them. Consider passing via `env` option in `fork()` (already done at `rc.ts:178-183`). That's fine.

2. **Document environment setup:**
```markdown
## Environment Setup (Linux)

Create `~/.config/claude-remote/.env`:
```
DISCORD_BOT_TOKEN=your_token
DISCORD_GUILD_ID=your_guild
DISCORD_CATEGORY_ID=your_category
```
Then load with `dotenv` package:
```typescript
import dotenv from 'dotenv';
dotenv.config({ path: join(CONFIG_DIR, '.env') });
```
```

3. **Add dotenv support:** Not currently used. Consider adding for convenience.
```bash
npm install dotenv
```

**Testing:**
- Start daemon with missing env → clear error, not "undefined" token
- Start daemon via `systemctl start claude-remote` with `EnvironmentFile=/etc/claude-remote.env` → works

---

### Pitfall 10: Unicode and Character Width

**What goes wrong:** Terminal handling in PTY might break with:
- Multi-byte UTF-8 characters (emoji, CJK)
- Double-width characters (CJK, emoji) affecting column counting
- Combining characters

On Linux, terminal emulators (xterm, gnome-terminal) handle UTF-8 differently than Windows Terminal. Claude output includes emoji (✅, ❌, 🟢) and possibly user code with Unicode.

**Severity:** Medium (UX issue)

**Consequences:**
- Terminal layout broken (TUI misaligned)
- Claude's cursor positioning off → display glitches
- Output truncated/corrupted

**Why it happens:**
- node-pty sets terminal to UTF-8 mode, but width calculation uses `String.length` (code units) not display cells
- Some Unicode characters (emoji, CJK) take 2 columns; combining marks take 0
- Windows Terminal and Linux terminals have different fallback fonts

**Detection:**
- Claude output contains emoji appears misaligned
- Ink prompt menus (select) show broken borders
- `process.stdout.columns` may not match actual display width with wide chars

**Mitigation:**

1. **Use proper Unicode width library:**
Install `string-width` or `wcwidth`:
```bash
npm install string-width
```
Then:
```typescript
import stringWidth from 'string-width';

// Instead of text.length, use:
const displayWidth = stringWidth(text);
```

But PTY layer handles this internally via terminal driver. The issue is if we do manual column calculations. Check code for manual cursor positioning — likely not present.

2. **Ensure PTY configured for UTF-8:**
```typescript
const proc = pty.spawn(CLAUDE_BIN, args, {
  name: "xterm-256color",  // Better than xterm-color
  cols: process.stdout.columns || 80,
  rows: process.stdout.rows || 24,
});
```
`xterm-256color` better supports Unicode.

3. **Test with diverse Unicode:**
```bash
echo "Hello 世界 👋" | claude-remote
```
Check alignment.

**Likelihood:** Low if Claude's own output is well-behaved. Medium if user input contains wide chars.

---

## Moderate Pitfalls

### Pitfall 11: Process Manager Differences (systemd vs NSSM)

**What goes wrong:** If deploying as service:
- Windows uses NSSM or `sc.exe`
- Linux uses systemd

Systemd has different semantics:
- `Restart=` policy may cause rapid restart loops
- `User=` directive affects environment and permissions
- `WorkingDirectory=` vs inherited cwd

**Why it happens:** Service configuration not portable.

**Severity:** Medium (deployment ops overhead)

**Mitigation:**

Provide systemd unit file:
```ini
[Unit]
Description=Claude Remote Daemon
After=network.target

[Service]
Type=simple
User=youruser
EnvironmentFile=/home/youruser/.config/claude-remote/.env
ExecStart=/usr/bin/claude-remote daemon  # or whatever the command is
Restart=on-failure
RestartSec=10

[Install]
WantedBy=multi-user.target
```

Document in README.

---

### Pitfall 12: Temporary File Cleanup

**What goes wrong:** Code at `daemon.ts:956-959`:
```typescript
for (const f of tempFiles) {
  try { fs.unlinkSync(f); } catch { /* may already be gone */ }
}
tempFiles.clear();
```

On Linux:
- `/tmp` may be mounted with `noexec` (execution forbidden) — not an issue for reading
- `/tmp` may be cleared on reboot — temp files lost if daemon running across reboot
- Better to use `os.tmpdir()` (already used at `daemon.ts:247`) which respects `TMPDIR`

**Severity:** Low (cleanup is best-effort anyway)

**Mitigation:** Already uses `os.tmpdir()` — Good. Ensure `TMPDIR` is set or default to `/tmp`. Consider:
- Periodic cleanup of old temp files on startup
- Use `tmp` package with auto-cleanup promises

---

### Pitfall 13: Clock Skew and Timezone

**What goes wrong:** Log timestamps (`new Date().toISOString()` at `daemon.ts:180`) assume system clock correct. Linux servers may have NTP sync issues.

**Severity:** Low (diagnostics only)

**Mitigation:** Use UTC consistently (already done with `toISOString`). Good.

---

## Testing Strategy Pitfalls on Linux

### Pitfall 14: Headless Testing Without GUI

**Problem:** Running PTY tests on CI (Linux) without a controlling TTY. `node-pty` requires a real TTY for some operations; `stdin.isTTY` may be false in CI.

**Detection:** Tests failing with "Pipes are not supported" or `israw` errors.

**Mitigation:**
- Use `tmux` or `script` to create PTY in CI:
```yaml
- run: sudo apt-get install -y tmux
- run: tmux new-session -d "npm test"
```
- Mock `node-pty` in unit tests with `sinon` or `jest.mock`
- Write integration tests that skip PTY portion on CI:
```typescript
if (!process.stdin.isTTY) {
  console.log('Skipping PTY integration test (no TTY)');
  return;
}
```

---

### Pitfall 15: Reproducing Windows-Only Bugs on Linux

**Problem:** Some bugs only manifest on Windows (ConPTY restore sequence, Windows Terminal escape codes). Can't reproduce on Linux to verify fix.

**Detection:** Impossible to verify without Windows machine.

**Mitigation:**
- Use GitHub Actions matrix: `os: [windows-latest, ubuntu-latest]`
- Document Windows-specific test steps
- Add `skip` markers for OS:
```typescript
if (process.platform !== 'win32') return; // Windows-only test
```

---

### Pitfall 16: Volume Mounts and File System Events (WSL2)

**Problem:** If developing on Windows with WSL2, file watching may not work across the `/mnt/c` mount boundary.

**Why:** inotify events may not propagate from Windows host to WSL2虚拟机.

**Severity:** Medium (dev experience)

**Mitigation:**
- Run claude-remote entirely inside WSL2 (not on Windows host with mounted files)
- Use `usePolling: true` in chokidar as workaround
- Document: "For WSL2 development, store project files in Linux filesystem (`~/`) not `/mnt/c/`"

---

## Packaging and Distribution Pitfalls

### Pitfall 17: Native Module(node-pty) Compatibility

**What goes wrong:** `node-pty` has native C++ component that must be compiled per Node.js version and ABI.

On Linux:
- `npm install` triggers `node-gyp` rebuild
- Requires `build-essential`, `python3`, `libstdc++` etc. or fails
- Prebuilt binaries may not exist for Alpine (musl) vs glibc

**Severity:** High (blocks install)

**Consequences:**
```
gyp ERR! build error
npm ERR! code ELIFECYCLE
npm ERR! node-pty@1.0.0 install: `node-gyp rebuild`
```

**Detection:** `npm install` fails on fresh Linux machine without build tools.

**Mitigation:**

1. **Document system dependencies:**
```markdown
### Linux Prerequisites

Before installing, ensure you have:
- Node.js 18+
- Build tools for native modules:
  - Ubuntu/Debian: `sudo apt-get install build-essential python3`
  - Alpine: `apk add python3 make g++`
  - Fedora: `sudo dnf install gcc-c++ make python3`
```

2. **Avoid musl-based distros or provide static binary:** Alpine uses musl; node-pty may need different build. Either:
- Don't officially support Alpine (use glibc-based distros)
- Or build static binaries for Alpine

3. **Use prebuilds:** node-pty provides prebuilds for common Linux distros. Ensure `npm config set ignore-scripts false` (default).

**Testing:**
- CI on `ubuntu-latest`, `alpine-latest` to catch build issues
- Docker build test: `FROM node:20-alpine` → `npm ci` → success/failure

---

### Pitfall 18: Shebang Line and Node Version

**What goes wrong:** Built `dist/cli.js` may have:
```javascript
#!/usr/bin/env node
```
But if user has Node 16 (not 18+), `discord.js` v14 requires Node 18+ and will throw:
```
Error [REQUIRED_VERSION_NOT_MET]: The Client requires Node.js 18.0.0 or newer.
```

**Severity:** Medium (runtime crash)

**Mitigation:**

1. **Check Node version at startup:**
```typescript
const [major] = process.version.slice(1).split('.');
if (parseInt(major) < 18) {
  console.error('[cli] Node.js 18+ required. Found:', process.version);
  process.exit(1);
}
```

2. **Declare `engines` in package.json:**
```json
"engines": {
  "node": ">=18.0.0"
}
```

3. **Document:** "Requires Node.js 18+"

---

### Pitfall 19: Symbolic Links and Path Resolution

**Problem:** On Linux, `import.meta.dirname` resolves correctly with symlinks? If user symlinks `claude-remote` binary:
```bash
ln -s ~/bin/claude-remote /usr/local/bin/claude-remote
```
`import.meta.dirname` in `rc.ts` and `daemon.ts` points to symlink location or real path?

**Current code at `daemon.ts:175`**:
```typescript
const daemonPath = path.resolve(import.meta.dirname, "daemon.js");
```
If `import.meta.dirname` isSymlink, `path.resolve` doesn't resolve symlink. Might try to load from wrong location if symlink points elsewhere.

**Severity:** Low (edge case)

**Mitigation:**
Use `path.resolve` + `fs.realpathSync`:
```typescript
const daemonPath = fs.realpathSync(path.join(import.meta.dirname, 'daemon.js'));
```
Or ensure `import.meta.dirname` is already real path? Node.js doesn't resolve symlinks for `import.meta.url`.

Better: document "Do not symlink the binary" or fix.

---

## Debugging Challenges on Linux

### Challenge 1: No Windows Terminal PTY Restore Issues

The Windows-specific escape sequence (`\x1b[?9001l`) won't run on Linux, but the condition checks `process.platform === "win32"` — so no issue. However, if ported naively without that check, terminal would get raw mode escape codes it doesn't understand.

**Mitigation:** Keep platform guards.

---

### Challenge 2: Attaching Debuggers to PTY Processes

PTY processes are pseudo-terminals; `node --inspect` may not attach easily. `gdb` needed for native `node-pty` debugging.

**Mitigation:**
- Add `--inspect` flag passthrough to `pty.spawn` if `DEBUG` env var set:
```typescript
const nodeArgs = process.env.DEBUG ? ['--inspect=9229'] : [];
const proc = pty.spawn('node', [...nodeArgs, 'claude.js'], { ... });
```
But Claude is an Electron app; won't work. Instead, log extensively (already done).

---

### Challenge 3: Permissions and Seccomp

Linux distributions with AppArmor/SELinux or `no_new_privs` may block `forkpty` or socket creation.

**Detection:** `ptyspawn` fails with `EPERM`.

**Mitigation:** Document: "Disable AppArmor/SELinux for this binary or add policy."

---

## Gotchas Summary by Dependency

### node-pty (v1.0.0)

| Gotcha | Windows | Linux | Mitigation |
|--------|---------|-------|------------|
| Binary name | `claude.exe` | `claude` | Detect platform |
| Signal forwarding | Manual via proc.write() | Automatic via forkpty | Test all signals |
| PTY restore hack | Escape sequence needed | Not needed | Keep platform guard |
| Zombie processes | Subree processes cleaned by ConPTY | Need explicit `waitpid` (node-pty handles) | Verify no zombies (ps) |
| Environment | Inherited from parent | Same | OK |

---

### chokidar (v4.0.3)

| Gotcha | Windows (fsevents not) | Linux (inotify) | Mitigation |
|--------|-----------------------|----------------|------------|
| Watch limit | No limit | 8192 default | Document increase |
| Atomic writes | Rename + create | Close_write event | Current code uses `awaitWriteFinish` — OK |
| Truncation detection | Rewind detected? | May not emit events | Check `newSize < lastFileSize` (current code does) |
| Permissions | ACLs | Unix perms | Ensure user owns file |
| Polling needed? | Rare | If inotify fails | Add `usePolling: true` fallback |

---

### discord.js (v14.18.0)

| Gotcha | Windows | Linux | Mitigation |
|--------|---------|-------|------------|
| Intents | Same | Same | Validate config |
| Socket hangup | Rare under load | More common on flaky networks | Add retry logic |
| Rate limits | Same | Same | Already has rate limiter |
| File permissions for sessions | `%APPDATA%` | `~/.config` | Use platform-appropriate CONFIG_DIR |

---

## Recommendations for Testing on Linux

### 1. Multi-Distro Matrix

Test on at least:
- Ubuntu 22.04+ (glibc)
- Alpine (musl) if claiming support
- WSL2 (shared Windows dev)

### 2. CI Configuration

```yaml
jobs:
  test-linux:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - name: Install deps
        run: npm ci
      - name: Build
        run: npm run build
      - name: Unit tests
        run: npm test  # with TTY available? use script
      - name: Integration test
        run: |
          sudo apt-get install -y tmux
          tmux new-session -d "npm run test:integration"
```

### 3. Manual Test Checklist

- [ ] `which claude-remote` finds binary
- [ ] `claude-remote --version` prints version
- [ ] Start daemon with valid `.env` → creates `~/.config/claude-remote/`
- [ ] `claude-remote /remote` enables → Discord posts startup message
- [ ] Type in Claude → messages appear in Discord channel
- [ ] Send Discord message → appears in Claude (permissions mode)
- [ ] Stop daemon (`/remote` off) → Discord posts shutdown message
- [ ] Kill parent process (`SIGTERM`) → daemon stops
- [ ] Kill daemon directly → parent notices and restarts (if enabled)
- [ ] Simulate JSONL truncation (delete/recreate) → recovers without crash
- [ ] Large JSONL (10MB) → replay completes in reasonable time
- [ ] File permissions: config dir on NFS? readonly? → fails gracefully
- [ ] inotify limit: start 10k watchers → see error message

### 4. Debug Build

Add `DEBUG=claude-remote:*` environment variable support using `debug` package:
```bash
npm install debug
```
```typescript
import debug from 'debug';
const log = debug('claude-remote:daemon');
log('Watching %s', jsonlPath);
```
Helps trace file watching, IPC messages.

---

## Conclusion

The port from Windows to Linux requires addressing:

1. **Critical blockers** (1-5): IPC path, PTY backend, file watching, signals, paths
2. **High-risk** (6-10): Line endings, Discord config, permissions, env vars, Unicode
3. **Packaging** (17-19): Native build, Node version, symlinks

**Priority order:**
1. Fix PIPE_NAME (critical)
2. Handle claude binary detection
3. Add truncation handling in watcher
4. Add inotify limit detection and guidance
5. Validate env vars and intents early
6. Add SIGPIPE ignore on Linux
7. Add daemon kill timeout
8. Document Linux install steps thoroughly
9. Test on CI with Ubuntu (and Alpine if desired)
10. Add `DEBUG` logging support

**Roadmap flags:**
- `node-pty` API differences unlikely to cause major rewrites — just glue code changes
- `chokidar` configuration tweaks needed (awaitWriteFinish, truncation)
- `discord.js` code mostly portable; intents and env validation needed
- Focus on lifecycle: start → IPC → PTY → watch → Discord → cleanup

**Bottom line:** The architecture is sound; port is mainly about platform abstraction layers and testing strategy. Most pitfalls documented above are straightforward fixes. The biggest unknown is real-world `claude` binary behavior on Linux (if/when it ships) — that requires actual testing with the product.
