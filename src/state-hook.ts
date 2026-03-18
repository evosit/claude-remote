#!/usr/bin/env node

/**
 * State hook — sends activity state signals to the rc.ts pipe server.
 * Handles both Stop and PostCompact events from Claude Code.
 * Only activates when CLAUDE_REMOTE_PIPE env var is set (by rc.ts).
 */

import { sendPipeMessage } from "./pipe-client.js";

async function main() {
  const pipeName = process.env.CLAUDE_REMOTE_PIPE;
  if (!pipeName) process.exit(0);

  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk as Buffer);
  }
  const input = Buffer.concat(chunks).toString("utf-8").trim();
  if (!input) process.exit(0);

  let payload: { hook_event_name?: string; trigger?: "manual" | "auto" };
  try {
    payload = JSON.parse(input);
  } catch {
    process.exit(0);
  }

  const event = payload.hook_event_name;
  if (!event) process.exit(0);

  let msg: Record<string, unknown> | null = null;

  if (event === "Stop") {
    msg = { type: "state-signal", event: "stop" };
  } else if (event === "PostCompact") {
    msg = { type: "state-signal", event: "post-compact", trigger: payload.trigger };
  }

  if (!msg) process.exit(0);

  try {
    await sendPipeMessage(pipeName, msg);
  } catch {
    // best effort
  }
}

main().catch(() => process.exit(0));
