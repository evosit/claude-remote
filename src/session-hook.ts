#!/usr/bin/env node

/**
 * SessionStart hook — sends session_id + transcript_path to the rc.ts pipe server.
 * Reads hook payload from stdin, sends it to the named pipe, exits immediately.
 */

import { findPipe, sendPipeMessage } from "./pipe-client.js";

async function main() {
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
  } catch {
    process.exit(0);
  }

  if (!payload.session_id || !payload.transcript_path) process.exit(0);

  const pipe = findPipe();
  if (!pipe) process.exit(0); // no discord-rc instance running, nothing to do

  try {
    await sendPipeMessage(pipe, {
      type: "session-register",
      sessionId: payload.session_id,
      transcriptPath: payload.transcript_path,
      cwd: payload.cwd,
    });
  } catch {
    // best effort — pipe might not be ready yet
  }
}

main().catch(() => process.exit(0));
