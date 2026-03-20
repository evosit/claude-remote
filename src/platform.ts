import { homedir } from 'node:os';
import { join } from 'node:path';

export function getPlatform(): 'win32' | 'linux' | 'darwin' {
  return process.platform as 'win32' | 'linux' | 'darwin';
}

export function getClaudeBinary(): string {
  return getPlatform() === 'win32' ? 'claude.exe' : 'claude';
}

export function getPipePath(): string {
  const pid = process.pid;
  if (getPlatform() === 'win32') {
    return `\\\\.\\pipe\\claude-remote-${pid}`;
  }
  const tmpDir = getPlatform() === 'darwin' ? '/private/tmp' : '/tmp';
  return join(tmpDir, `claude-remote-${pid}.sock`);
}

export function getConfigDir(): string {
  const home = homedir();
  if (getPlatform() === 'win32') {
    return join(home, 'AppData', 'Roaming', 'claude-remote');
  }
  // Keep existing config location for v1 (no XDG migration yet)
  return join(home, '.claude', 'claude-remote');
}

export function getShellProfiles(): Array<{ path: string; line: string; marker: string }> {
  const home = homedir();
  const ALIAS_MARKER = '# claude-remote alias — do not edit manually';

  if (getPlatform() === 'win32') {
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

  return targets;
}

export function shouldCleanupSocket(): boolean {
  return getPlatform() !== 'win32';
}
