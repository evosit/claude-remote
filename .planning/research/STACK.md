# Platform Support Research: Linux Support

**Project**: claude-remote (@hoangvu12/claude-remote v1.2.0)
**Focus**: Linux platform support requirements
**Researched**: 2025-03-20

## Executive Summary

claude-remote is currently Windows-only due to three hardcoded assumptions:
1. **Binary**: `claude.exe` vs Linux `claude`
2. **IPC**: Windows named pipes vs Unix domain sockets  
3. **Shell aliases**: PowerShell/Git Bash/CMD vs Bash/Zsh/Fish

Linux support requires platform abstractions in `rc.ts`, `pipe-client.ts`, and `cli.ts`. node-pty already supports both platforms natively. Claude Code CLI officially supports Ubuntu 20.04+, Debian 10+, Alpine 3.19+.

---

## Platform Differences Requiring Changes

### 1. node-pty Linux Support (✅ Already Works)

node-pty v1.0.0 handles:
- **Windows**: ConPTY
- **Linux/macOS**: forkpty from util-linux

**No code changes** needed for basic PTY spawning once binary name is fixed.

Terminal cleanup: ConPTY requires `\x1b[?9001l` on Windows only. Code already conditionally executes on `win32`.

---

### 2. IPC: Named Pipes → Unix Domain Sockets

**Problem**: `\\.\pipe\claude-remote-${pid}` invalid on Linux.

**Solution**: Platform-specific path generation:

```typescript
function getPipePath(): string {
  if (process.platform === 'win32') {
    return `\\\\.\\pipe\\claude-remote-${process.pid}`;
  }
  const tmpDir = process.platform === 'darwin' ? '/private/tmp' : '/tmp';
  return path.join(tmpDir, `claude-remote-${process.pid}.sock`);
}
```

**Files to change**:
- `src/rc.ts`: Replace `PIPE_NAME`, update `startPipeServer()`, add socket cleanup
- `src/pipe-client.ts`: `findPipe()` should handle Unix socket files; clean up stale `.sock` files

**Filesystem vs abstract sockets**: Use filesystem (`/tmp/*.sock`) for debuggability and macOS compatibility.

---

### 3. Claude Code Binary Name

**Problem**: `rc.ts:15` = `CLAUDE_BIN = "claude.exe"` (Windows only).

**Solution**:

```typescript
function getClaudeBinary(): string {
  return process.platform === 'win32' ? 'claude.exe' : 'claude';
}
```

Add verification:

```typescript
function verifyClaudeInPath(): string | null {
  const bin = getClaudeBinary();
  try {
    const cmd = process.platform === 'win32' ? 'where' : 'which';
    const result = execSync(`${cmd} ${bin}`, { encoding: 'utf-8' }).trim();
    return result || null;
  } catch {
    return null;
  }
}
```

Display install instructions if missing:
- Linux: `curl -fsSL https://claude.ai/install.sh | bash`
- Windows: `irm https://claude.ai/install.ps1 | iex`

---

### 4. Shell Alias Installation

**Problem**: `cli.ts:getAliasTargets()` only targets Windows shells.

**Solution**: Add Linux shell detection:

```typescript
type ShellType = "bash" | "zsh" | "fish" | "powershell" | "pwsh" | "gitbash" | "cmd";

function getAliasTargets(): AliasTarget[] {
  const targets: AliasTarget[] = [];
  const home = os.homedir();

  if (process.platform === 'win32') {
    // Existing Windows detection (PowerShell 5, PowerShell 7, Git Bash, CMD)
  } else {
    // Linux/macOS
    const shell = process.env.SHELL || '';

    if (shell.includes('bash') || fs.existsSync(path.join(home, '.bashrc'))) {
      targets.push({
        shell: 'bash',
        profilePath: path.join(home, '.bashrc'),
        aliasLine: `claude() { claude-remote "$@"; } ${ALIAS_MARKER}`,
        description: 'Bash',
      });
    }

    if (shell.includes('zsh') || fs.existsSync(path.join(home, '.zshrc'))) {
      targets.push({
        shell: 'zsh',
        profilePath: path.join(home, '.zshrc'),
        aliasLine: `claude() { claude-remote "$@"; } ${ALIAS_MARKER}`,
        description: 'Zsh',
      });
    }

    if (shell.includes('fish') || fs.existsSync(path.join(home, '.config', 'fish', 'config.fish'))) {
      targets.push({
        shell: 'fish',
        profilePath: path.join(home, '.config', 'fish', 'config.fish'),
        aliasLine: `function claude; claude-remote $argv; end ${ALIAS_MARKER}`,
        description: 'Fish',
      });
    }
  }

  return targets;
}
```

Fish syntax is `function claude; claude-remote $argv; end`.

---

### 5. Paths & Environment

`path.join(os.homedir(), ...)` works cross-platform ✅

No changes to:
- Config dir `~/.claude-remote`
- Pipe registry `~/.claude-remote/pipes`
- Transcript paths (`~/.claude/projects/...`)

`ensureCmdShimInPath()` should be Windows-only (no-op on Linux).

---

### 6. Distribution-Specific Notes

**Alpine Linux (musl)**: Claude Code itself requires:
```bash
apk add libgcc libstdc++ ripgrep
```

Set `USE_BUILTIN_RIPGREP=0` in `~/.claude/settings.json` env.

claude-remote doesn't directly depend on these, but users need Claude Code functional.

---

## Implementation Checklist

### Files to Modify

#### `src/rc.ts`
- [ ] Line 12: Replace `PIPE_NAME` with `pipePath = getPipePath()`
- [ ] Line 15: Replace `CLAUDE_BIN` with `getClaudeBinary()`
- [ ] Before `pty.spawn()`: Verify binary exists, error with install instructions
- [ ] Line 123: `pipeServer.listen(pipePath)`
- [ ] Line 144-150: On non-Windows, `fs.unlinkSync(pipePath)` if exists
- [ ] `registerPipe()`: Store full path in registry JSON

#### `src/pipe-client.ts`
- [ ] `findPipe()`: Handle both pipe and socket paths; attempt connection, skip dead
- [ ] On connection error `ECONNREFUSED`/`ENOENT`, clean up stale socket file
- [ ] Improve error messages (“Socket connection refused” vs generic)

#### `src/cli.ts`
- [ ] Refactor `getAliasTargets()`: Windows branch, else Linux/macOS branch
- [ ] Wrap `ensureCmdShimInPath()` in `if (process.platform === 'win32')`
- [ ] Platform-specific messaging (e.g., “Restart your shell”)

Optional: Add Alpine dependency check to `setup()` (nice-to-have).

#### `README.md` (documentation)
- [ ] Add Linux installation/setup section
- [ ] Update platform support from “Windows only” to include Linux/macOS
- [ ] Mention Alpine prerequisites

---

## Testing Checklist (Ubuntu 22.04+)

1. [ ] `npm install -g @hoangvu12/claude-remote` succeeds
2. [ ] Install Claude Code: `curl -fsSL https://claude.ai/install.sh | bash`
3. [ ] `claude-remote setup` → configure Discord token
4. [ ] `claude` → spawns PTY with rc.js
5. [ ] `/remote on` creates Discord channel
6. [ ] Claude output appears in Discord
7. [ ] Button clicks (Allow/Deny) work in reverse direction
8. [ ] Socket file `/tmp/claude-remote-<pid>.sock` exists during runtime, cleaned up on exit
9. [ ] Pipe registry contains correct socket path
10. [ ] Aliases install to `~/.bashrc` or `~/.zshrc` appropriately

---

## Risks

1. **Alpine**: node-pty may need compilation → user needs `python3 make g++`
2. **Socket cleanup**: Crashes may leave stale `.sock` files; `findPipe()` must handle `EADDRINUSE`
3. **Shell detection**: `$SHELL` may not match actual shell; existence checks are fallback
4. **WSL**: Should work (Linux platform), but test WSL1/2

---

## Conclusion

Linux support is straightforward: platform abstractions for IPC, binary, and shell configs. No major architectural changes. node-pty requires no modifications. Estimated effort: 2-4 hours implementation + 1-2 hours testing.
