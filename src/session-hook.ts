#!/usr/bin/env node

/**
 * SessionStart hook — sends session_id + transcript_path to the rc.ts pipe server.
 * Only activates when CLAUDE_REMOTE_PIPE env var is set (by rc.ts), so it won't
 * fire in plain Claude sessions that weren't started via claude-remote.
 */

import { sendPipeMessage } from "./pipe-client.js";

async function main() {
  // Only connect if this Claude session was spawned by claude-remote
  const pipeName = process.env.CLAUDE_REMOTE_PIPE;
  if (!pipeName) process.exit(0);

  // Read stdin (hook payload from Claude Code)
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk as Buffer);
  }
  const input = Buffer.concat(chunks).toString("utf-8").trim();
  if (!input) process.exit(0);

  let payload: { session_id?: string; transcript_path?: string; cwd?: string };
  try {
    payload = JSON.parse(input);
  } catch (err) {
    process.stderr.write(`[session-hook] Invalid JSON: ${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(0);
  }

  if (!payload.session_id || !payload.transcript_path) {
    process.stderr.write("[session-hook] Missing required fields (session_id, transcript_path)\n");
    process.exit(0);
  }

  try {
    await sendPipeMessage(pipeName, {
      type: "session-register",
      sessionId: payload.session_id,
      transcriptPath: payload.transcript_path,
      cwd: payload.cwd,
    });
  } catch (err) {
    // Best effort — pipe might not be ready yet, but log for debugging
    process.stderr.write(`[session-hook] Failed to send session-register: ${err instanceof Error ? err.message : String(err)}\n`);
  }
}

main().catch((err) => {
  process.stderr.write(`[session-hook] Unexpected error: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(0);
});
