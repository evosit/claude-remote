import { homedir } from 'node:os';
import { join } from 'node:path';
import debug from 'debug';

const d = debug('claude-remote:platform');

export function getPlatform(): 'win32' | 'linux' | 'darwin' {
  const platform = process.platform as 'win32' | 'linux' | 'darwin';
  d('getPlatform: %s', platform);
  return platform;
}

export function getClaudeBinary(): string {
  const binary = getPlatform() === 'win32' ? 'claude.exe' : 'claude';
  d('getClaudeBinary: %s', binary);
  return binary;
}

export function getPipePath(): string {
  const pid = process.pid;
  let path: string;
  if (getPlatform() === 'win32') {
    path = `\\\\.\\pipe\\claude-remote-${pid}`;
  } else {
    const tmpDir = getPlatform() === 'darwin' ? '/private/tmp' : '/tmp';
    path = join(tmpDir, `claude-remote-${pid}.sock`);
  }
  d('getPipePath: %s', path);
  return path;
}

export function getConfigDir(): string {
  const home = homedir();
  let dir: string;
  if (getPlatform() === 'win32') {
    dir = join(home, 'AppData', 'Roaming', 'claude-remote');
  } else {
    // Keep existing config location for v1 (no XDG migration yet)
    dir = join(home, '.claude', 'claude-remote');
  }
  d('getConfigDir: %s', dir);
  return dir;
}

export function getShellProfiles(): Array<{ path: string; line: string; marker: string }> {
  const home = homedir();
  const ALIAS_MARKER = '# claude-remote alias — do not edit manually';

  if (getPlatform() === 'win32') {
    d('getShellProfiles: Windows -> []');
    return []; // Windows shells handled separately in cli.ts
  }

  const targets: Array<{ path: string; line: string; marker: string }> = [];

  // Bash
  targets.push({
    path: join(home, '.bashrc'),
    line: `alias claude='claude-remote' ${ALIAS_MARKER}`,
    marker: ALIAS_MARKER,
  });

  // Zsh
  targets.push({
    path: join(home, '.zshrc'),
    line: `alias claude='claude-remote' ${ALIAS_MARKER}`,
    marker: ALIAS_MARKER,
  });

  // Fish
  targets.push({
    path: join(home, '.config', 'fish', 'config.fish'),
    line: `alias claude='claude-remote' ${ALIAS_MARKER}`,
    marker: ALIAS_MARKER,
  });

  d('getShellProfiles: %d targets', targets.length);
  return targets;
}

export function shouldCleanupSocket(): boolean {
  const should = getPlatform() !== 'win32';
  d('shouldCleanupSocket: %s', should);
  return should;
}
