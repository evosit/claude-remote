#!/usr/bin/env node

/**
 * SessionStart hook — sends session_id + transcript_path to the rc.ts pipe server.
 * Only activates when DISCORD_RC_PIPE env var is set (by rc.ts), so it won't
 * fire in plain Claude sessions that weren't started via discord-rc.
 */

import { sendPipeMessage } from "./pipe-client.js";

async function main() {
  // Only connect if this Claude session was spawned by discord-rc
  const pipeName = process.env.DISCORD_RC_PIPE;
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
  } catch {
    process.exit(0);
  }

  if (!payload.session_id || !payload.transcript_path) process.exit(0);

  try {
    await sendPipeMessage(pipeName, {
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
