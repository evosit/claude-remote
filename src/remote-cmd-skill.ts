#!/usr/bin/env node
/**
 * Standalone remote-cmd for the /remote skill.
 * This script can be executed directly and resolves the actual package location
 * at runtime to load its dependencies and locate the pipe registry.
 */

import * as fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

// In ESM, __dirname is not available. Compute it from import.meta.url.
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const require = createRequire(import.meta.url);

// Find the package root by looking for package.json
function findPackageRoot(startDir: string): string | null {
  let current = startDir;
  while (current !== path.parse(current).root) {
    try {
      if (fs.existsSync(path.join(current, 'package.json'))) {
        const pkg = JSON.parse(fs.readFileSync(path.join(current, 'package.json'), 'utf-8'));
        if (pkg.name === '@dacineu/claude-remote') {
          return current;
        }
      }
    } catch {
      // ignore
    }
    current = path.dirname(current);
  }
  return null;
}

// Get the pipe using the installed package's pipe-client module
async function findPipe(): Promise<string | null> {
  const packageRoot = findPackageRoot(__dirname);
  if (!packageRoot) {
    console.error('[remote-cmd] Could not find package root');
    return null;
  }

  // Load the PIPE_REGISTRY path from the installed package's utils.js
  const utilsPath = path.join(packageRoot, 'dist', 'utils.js');
  try {
    // Use dynamic import to load the ESM module
    const utils = await import(utilsPath);
    const PIPE_REGISTRY = utils.PIPE_REGISTRY || path.join(packageRoot, 'dist', 'pipes');

    // Scan pipe registry for active pipe
    if (fs.existsSync(PIPE_REGISTRY)) {
      const files = fs.readdirSync(PIPE_REGISTRY).filter((f) => f.endsWith('.json'));
      for (const file of files) {
        try {
          const entry = JSON.parse(fs.readFileSync(path.join(PIPE_REGISTRY, file), 'utf-8'));
          // Verify process is alive
          try {
            process.kill(entry.pid, 0);
            return entry.pipe;
          } catch {
            // Dead process, skip
          }
        } catch {
          // skip bad files
        }
      }
    }
  } catch (err) {
    console.error('[remote-cmd] Failed to load package utils:', err instanceof Error ? err.message : err);
  }
  return null;
}

// Send message to pipe and receive response
async function sendPipeMessage(pipeName: string, msg: Record<string, unknown>): Promise<Record<string, unknown> | null> {
  return new Promise((resolve) => {
    const socket = require('net').createConnection(pipeName, () => {
      socket.write(JSON.stringify(msg));
    });

    socket.on('data', (data: Buffer) => {
      try {
        const resp = JSON.parse(data.toString()) as Record<string, unknown>;
        resolve(resp);
      } catch {
        resolve(null);
      }
      socket.end();
    });

    socket.on('error', () => resolve(null));
    socket.on('timeout', () => resolve(null));
  });
}

// Main
async function main() {
  const args = process.argv.slice(2);
  const subcommand = args[0]?.toLowerCase();

  // Get pipe (try environment first, then registry)
  const pipe = process.env.CLAUDE_REMOTE_PIPE || await findPipe();

  if (!pipe) {
    console.log('ERROR: No active claude-remote instance. Start Claude with `claude-remote`.');
    process.exit(1);
  }

  if (subcommand === 'status') {
    // Query status
    const response = await sendPipeMessage(pipe, { type: 'status' });
    if (response && response.status === 'ok' && typeof response === 'object') {
      const active = response.active === true;
      console.log(active ? 'ON' : 'OFF');
      if (active && response.channelName) {
        console.log(`Channel: ${response.channelName}`);
      }
    } else {
      console.log('OFF');
    }
    process.exit(0);
  }

  if (subcommand === 'off') {
    await sendPipeMessage(pipe, { type: 'disable' });
    console.log('Discord sync disabled');
    process.exit(0);
  }

  // 'on' with optional channel name, 'off', or toggle (no args)
  let channelName: string | undefined;
  if (subcommand === 'on') {
    channelName = args.slice(1).join(' ') || undefined;
  } else if (subcommand === 'off' || subcommand === 'status') {
    // These are handled above, but for clarity: no channel name
  } else {
    // Toggle mode (no subcommand) - don't use args as channel name
    if (args.length > 0) {
      console.error('ERROR: Unexpected arguments. Use "on [name]" to specify a channel name.');
      process.exit(1);
    }
  }
  await sendPipeMessage(pipe, { type: 'enable', channelName: channelName || undefined });
  if (channelName) {
    console.log(`Discord sync enabled (${channelName})`);
  } else {
    console.log('Discord sync enabled');
  }
}

main().catch((err) => {
  console.error('remote-cmd error:', err instanceof Error ? err.message : err);
  process.exit(1);
});
