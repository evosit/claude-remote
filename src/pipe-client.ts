/**
 * Shared pipe client utilities used by discord-hook.ts and discord-cmd.ts.
 */

import net from "node:net";
import fs from "node:fs";
import path from "node:path";
import { PIPE_REGISTRY } from "./utils.js";
import * as platform from "./platform.js";

export interface PipeEntry {
  pid: number;
  pipe: string;
  cwd: string;
  startedAt: string;
}

export function findPipe(): string | null {
  try {
    const files = fs.readdirSync(PIPE_REGISTRY).filter((f) => f.endsWith(".json"));
    for (const file of files) {
      try {
        const entry = JSON.parse(fs.readFileSync(path.join(PIPE_REGISTRY, file), "utf-8")) as PipeEntry;

        // On non-Windows, verify socket file exists (stale entry cleanup)
        if (platform.shouldCleanupSocket()) {
          try {
            fs.statSync(entry.pipe);
          } catch {
            // Socket file missing → stale entry
            try { fs.unlinkSync(path.join(PIPE_REGISTRY, file)); } catch {}
            continue;
          }
        }

        // Check if process still alive
        try {
          process.kill(entry.pid, 0);
          return entry.pipe;
        } catch {
          // Process dead, clean up stale entry
          try { fs.unlinkSync(path.join(PIPE_REGISTRY, file)); } catch {}
        }
      } catch { /* skip bad files */ }
    }
  } catch { /* registry doesn't exist */ }
  return null;
}

export function sendPipeMessage(pipeName: string, msg: Record<string, unknown>): Promise<Record<string, unknown> | null> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      socket.destroy();
      reject(new Error("Pipe connection timeout"));
    }, 3000);

    const socket = net.createConnection(pipeName, () => {
      socket.write(JSON.stringify(msg));
    });

    socket.on("data", (data) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.end();
      try {
        resolve(JSON.parse(data.toString()));
      } catch {
        resolve(null);
      }
    });

    socket.on("error", (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(err);
    });
  });
}
