import * as pty from "node-pty";
import net from "node:net";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { fork, type ChildProcess } from "node:child_process";
import which from "which";
import { STATUS_FLAG, PIPE_REGISTRY, safeUnlink } from "./utils.js";
import * as platform from "./platform.js";
import type { DaemonToParent, PipeMessage } from "./types.js";
import dotenv from 'dotenv';
import debug from 'debug';

const d = debug('claude-remote:rc');

// Load .env file from config directory (if present)
dotenv.config({ path: path.join(platform.getConfigDir(), '.env') });

// ── Constants ──

const PIPE_PATH = platform.getPipePath();
const CLAUDE_BIN = platform.getClaudeBinary();
d('PIPE_PATH=%s, CLAUDE_BIN=%s', PIPE_PATH, CLAUDE_BIN);

// ── State ──

const cliArgs = process.argv.slice(2);
const initialPermissionMode = cliArgs.includes("--dangerously-skip-permissions") ? "bypassPermissions" : "default";

let daemon: ChildProcess | null = null;
let sessionId: string | null = null;
let transcriptPath: string | null = null;
let projectDir = process.cwd();
let daemonWasEnabled = false;
let lastChannelId: string | null = null;

// ── Terminal restore (Windows ConPTY leaves win32-input-mode enabled) ──

function restoreTerminal() {
  if (process.stdin.isTTY) process.stdin.setRawMode(false);
  // Disable win32-input-mode that ConPTY enables on Windows Terminal
  if (process.platform === "win32") {
    process.stdout.write("\x1b[?9001l");
  }
  process.stdin.unref();
}

// ── Spawn Claude in PTY ──

// Set env var so the SessionStart hook only connects to THIS rc instance
process.env.CLAUDE_REMOTE_PIPE = PIPE_PATH;

// Verify Claude binary exists in PATH before spawning
function verifyClaudeInPath(): string | null {
  try {
    const path = which.sync(CLAUDE_BIN);
    d('verifyClaudeInPath: found at %s', path);
    return path;
  } catch (err) {
    d('verifyClaudeInPath: not found');
    return null;
  }
}

const claudePath = verifyClaudeInPath();
if (!claudePath) {
  console.error(`Claude binary '${CLAUDE_BIN}' not found in PATH`);
  if (platform.getPlatform() !== 'win32') {
    console.error('Install Claude Code: curl -fsSL https://claude.ai/install.sh | bash');
  } else {
    console.error('Install Claude Code from https://claude.ai/install');
  }
  process.exit(1);
}

const proc = pty.spawn(CLAUDE_BIN, process.argv.slice(2), {
  name: "xterm-color",
  cols: process.stdout.columns || 120,
  rows: process.stdout.rows || 30,
  cwd: projectDir,
  env: process.env as Record<string, string>,
});

proc.onData((data) => {
  process.stdout.write(data);
});

if (process.stdin.isTTY) {
  process.stdin.setRawMode(true);
}
process.stdin.resume();
process.stdin.on("data", (data) => {
  proc.write(data.toString());
});

process.stdout.on("resize", () => {
  proc.resize(process.stdout.columns || 120, process.stdout.rows || 30);
});

proc.onExit(({ exitCode }) => {
  restoreTerminal();
  stopDaemon();
  cleanupPipeServer();
  setStatusFlag(false);
  process.exit(exitCode);
});

// ── Named Pipe Server ──

let pipeServer: net.Server | null = null;

function startPipeServer() {
  pipeServer = net.createServer((socket) => {
    socket.on("data", (data) => {
      try {
        const msg = JSON.parse(data.toString()) as PipeMessage;

        if (msg.type === "session-register") {
          const oldSessionId = sessionId;
          sessionId = msg.sessionId;
          transcriptPath = msg.transcriptPath;
          if (msg.cwd) projectDir = msg.cwd;

          d('session-registered: sid=%s, cwd=%s', sessionId, projectDir);

          // If daemon was running on a different session, restart it
          if (daemonWasEnabled && oldSessionId && oldSessionId !== sessionId) {
            stopDaemon();
            startDaemon();
          }

          socket.write(JSON.stringify({ status: "ok" }));
        } else if (msg.type === "enable") {
          if (msg.sessionId) sessionId = msg.sessionId;
          startDaemon(msg.channelName);
          socket.write(JSON.stringify({ status: "ok", active: true }));
        } else if (msg.type === "disable") {
          daemonWasEnabled = false;
          stopDaemon();
          socket.write(JSON.stringify({ status: "ok", active: false }));
        } else if (msg.type === "state-signal") {
          if (daemon) daemon.send({ type: "state-signal", event: msg.event, trigger: msg.trigger });
          socket.write(JSON.stringify({ status: "ok" }));
        } else if (msg.type === "status") {
          socket.write(JSON.stringify({ status: "ok", active: daemon !== null }));
        }
      } catch {
        socket.write(JSON.stringify({ status: "error" }));
      }
      socket.end();
    });
  });

  pipeServer.on("error", (err) => {
    d('pipeServer error: %s', err.message);
  });

  // Clean up stale socket on non-Windows before listening
  if (platform.shouldCleanupSocket()) {
    try { fs.unlinkSync(PIPE_PATH); } catch {}
  }

  pipeServer.listen(PIPE_PATH, () => {
    d('pipeServer listening on %s', PIPE_PATH);
    registerPipe();
  });
}

function registerPipe() {
  try {
    fs.mkdirSync(PIPE_REGISTRY, { recursive: true });
    fs.writeFileSync(path.join(PIPE_REGISTRY, `${process.pid}.json`), JSON.stringify({
      pid: process.pid,
      pipe: PIPE_PATH,
      cwd: projectDir,
      startedAt: new Date().toISOString(),
    }));
  } catch { /* best effort */ }
}

function unregisterPipe() {
  safeUnlink(path.join(PIPE_REGISTRY, `${process.pid}.json`));
}

function cleanupPipeServer() {
  if (pipeServer) {
    d('cleanupPipeServer: closing pipeServer');
    pipeServer.close();
    pipeServer = null;
  } else {
    d('cleanupPipeServer: pipeServer already null');
  }
  unregisterPipe();
}

// ── Status flag ──

function setStatusFlag(active: boolean) {
  if (active) {
    try {
      fs.mkdirSync(path.dirname(STATUS_FLAG), { recursive: true });
    } catch (err) {
      console.error(`[rc] Failed to create status directory: ${err instanceof Error ? err.message : err}`);
      throw err;
    }
    try {
      fs.writeFileSync(STATUS_FLAG, String(process.pid));
    } catch (err) {
      console.error(`[rc] Failed to write status flag to ${STATUS_FLAG}: ${err instanceof Error ? err.message : err}`);
      throw err;
    }
  } else {
    safeUnlink(STATUS_FLAG);
  }
}

// ── Daemon management ──

let lastChannelName: string | undefined;

function startDaemon(channelName?: string) {
  daemonWasEnabled = true;
  if (channelName !== undefined) lastChannelName = channelName;

  if (daemon) return;

  if (!sessionId) return;

  const daemonPath = path.resolve(import.meta.dirname, "daemon.js");

  daemon = fork(daemonPath, [], {
    env: {
      ...process.env,
      DISCORD_BOT_TOKEN: process.env.DISCORD_BOT_TOKEN || "",
      DISCORD_GUILD_ID: process.env.DISCORD_GUILD_ID || "",
      DISCORD_CATEGORY_ID: process.env.DISCORD_CATEGORY_ID || "",
    },
    stdio: ["pipe", "pipe", "pipe", "ipc"],
  });

  // Log daemon output to file for debugging
  const logStream = fs.createWriteStream(path.join(os.homedir(), ".claude-remote", "daemon.log"), { flags: "a" });
  daemon.stdout?.pipe(logStream);
  daemon.stderr?.pipe(logStream);

  daemon.on("message", (msg: DaemonToParent) => {
    if (msg.type === "pty-write") {
      if (msg.raw) {
        proc.write(msg.text);
      } else if (msg.text.includes("\n")) {
        // Wrap multiline text in bracketed paste so Ink treats it as a single paste
        proc.write(`\x1b[200~${msg.text}\x1b[201~`);
      } else {
        proc.write(msg.text + "\r");
      }
    } else if (msg.type === "daemon-ready") {
      lastChannelId = msg.channelId;
      setStatusFlag(true);
    }
  });

  daemon.on("exit", (code) => {
    daemon = null;
    // Auto-restart on hot-reload exit or unexpected crash
    if (daemonWasEnabled && code !== null) {
      setTimeout(() => startDaemon(lastChannelName), 1000);
    }
  });

  daemon.on("error", () => {
    daemon = null;
  });

  // Set status flag immediately so statusline shows On right away
  setStatusFlag(true);

  // Pass transcript path directly if we have it from the hook
  daemon.send({ type: "session-info", sessionId, projectDir, channelName, transcriptPath, reuseChannelId: lastChannelId || undefined, initialPermissionMode });
}

function stopDaemon() {
  if (!daemon) {
    d('stopDaemon: no daemon running');
    return;
  }
  d('stopDaemon: killing daemon (pid=%d)', daemon.pid);
  daemon.kill("SIGTERM");
  daemon = null;
  setStatusFlag(false);
}

// ── Start ──

startPipeServer();

// Hot-reload is handled by the daemon itself — it watches its own files
// and exits with a special code. The auto-restart in daemon.on("exit") picks it up.

// ── Graceful shutdown ──

function shutdown() {
  d('shutdown: beginning');
  restoreTerminal();
  stopDaemon();
  cleanupPipeServer();
  proc.kill();
  d('shutdown: proc killed, will exit after onExit or timeout');
  // Don't process.exit() here — let proc.onExit handle it so node-pty can clean up.
  // Fallback exit in case the PTY doesn't fire onExit.
  setTimeout(() => process.exit(0), 500);
}

// Cleanup socket on exit (non-Windows)
process.on("exit", () => {
  if (platform.shouldCleanupSocket()) {
    try { fs.unlinkSync(PIPE_PATH); } catch {}
  }
});

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
