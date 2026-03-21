#!/usr/bin/env node

import * as p from "@clack/prompts";
import pc from "picocolors";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execSync } from "node:child_process";
import { createRequire } from "node:module";
import * as platform from "./platform.js";
import type { Config } from "./types.js";
import { getInstalledPath } from "./utils.js";

const CONFIG_DIR = platform.getConfigDir();
const CONFIG_FILE = path.join(CONFIG_DIR, "config.json");
const UPDATE_CACHE = path.join(CONFIG_DIR, "update-check.json");
const CHECK_INTERVAL = 60 * 60 * 1000; // 1 hour

// Workaround for @clack/prompts spinner leaving stdin in broken state on Windows.
// The spinner's block() function puts stdin into raw mode but never restores it on
// Windows, which prevents all subsequent prompts from receiving keyboard input.
// See: https://github.com/bombshell-dev/clack/issues/176
//      https://github.com/bombshell-dev/clack/issues/408
type Task = {
  title: string;
  task: (message: (string: string) => void) => string | Promise<string> | void | Promise<void>;
  enabled?: boolean;
};

async function tasks(taskList: Task[]) {
  await p.tasks(taskList);
  if (process.platform === "win32" && process.stdin.isTTY) {
    process.stdin.setRawMode(false);
  }
}

// Read our own version from package.json
const require = createRequire(import.meta.url);
const PKG_NAME: string = require("../package.json").name;
const PKG_VERSION: string = require("../package.json").version;

// ── Helpers ──

export function loadConfig(): Config | null {
  try {
    return JSON.parse(fs.readFileSync(CONFIG_FILE, "utf-8")) as Config;
  } catch {
    return null;
  }
}

function saveConfig(config: Config) {
  try {
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
  } catch (err) {
    console.error(`[cli] Failed to create config directory at ${CONFIG_DIR}: ${err instanceof Error ? err.message : err}`);
    throw err;
  }
  try {
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2) + "\n");
  } catch (err) {
    console.error(`[cli] Failed to write config file to ${CONFIG_FILE}: ${err instanceof Error ? err.message : err}`);
    throw err;
  }
}

function getClaudeSettingsPath(): string {
  return path.join(os.homedir(), ".claude", "settings.json");
}

function getSkillDir(): string {
  return path.join(os.homedir(), ".claude", "skills", "remote");
}

function getStatuslineCommand(): string {
  return `node "${getInstalledPath("statusline")}"`;
}

// ── Skill & statusline management ──

const HOOK_EVENT_TYPES = ["UserPromptSubmit", "SessionStart", "Stop"];
const HOOK_SCRIPT_NAMES = ["discord-hook", "session-hook", "state-hook"];

function isOurHook(h: Record<string, string>): boolean {
  return HOOK_SCRIPT_NAMES.some((name) => h.command?.includes(name));
}

/**
 * Remove ALL claude-remote hooks from the settings.hooks object,
 * regardless of which event they are registered under.
 * This ensures clean reinstall even if old hooks were in unexpected events.
 */
function removeAllRemoteHooks(hooks: Record<string, unknown[]>) {
  for (const eventType of Object.keys(hooks)) {
    if (Array.isArray(hooks[eventType])) {
      hooks[eventType] = hooks[eventType].filter((entry: unknown) => {
        const e = entry as Record<string, unknown>;
        const innerHooks = e.hooks as Array<Record<string, string>> | undefined;
        return !innerHooks?.some(isOurHook);
      });
      if (hooks[eventType].length === 0) delete hooks[eventType];
    }
  }
}

function getHookCommand(scriptName: string): string {
  return `node "${getInstalledPath(scriptName)}"`;
}

function installHooksAndStatusline() {
  // Remove old /discord skill if it exists (migration from discord-rc)
  const oldSkillDir = path.join(os.homedir(), ".claude", "skills", "discord");
  fs.rmSync(oldSkillDir, { recursive: true, force: true });

  // Install /remote skill (model not specified to avoid conflicts; uses default)
  const skillDir = getSkillDir();
  fs.mkdirSync(skillDir, { recursive: true });

  // Use absolute path to remote-cmd.js to avoid PATH lookup issues
  const remoteCmdPath = getInstalledPath("remote-cmd");

  const skillContent = `---
name: remote
description: Toggle remote control sync for this session
allowed-tools: Bash
---

Run the remote-cmd CLI to toggle/control remote sync. Pass through any arguments the user provided.

\`\`\`bash
node "${remoteCmdPath}" $ARGUMENTS
\`\`\`

Print the output to the user. Do not add any extra commentary.
`;

  fs.writeFileSync(path.join(skillDir, "SKILL.md"), skillContent);

  // Install hooks + statusline into settings
  const settingsPath = getClaudeSettingsPath();
  let settings: Record<string, unknown> = {};

  try {
    settings = JSON.parse(fs.readFileSync(settingsPath, "utf-8"));
  } catch { /* start fresh */ }

  // Statusline
  settings.statusLine = {
    type: "command",
    command: getStatuslineCommand(),
  };

  // Build hooks — clean any existing claude-remote hooks first, then add ours
  const hooks = (settings.hooks || {}) as Record<string, unknown[]>;

  // Clean old claude-remote hooks from ALL event types (comprehensive cleanup)
  removeAllRemoteHooks(hooks);

  // Add SessionStart hook — registers session info with rc.ts
  if (!hooks.SessionStart) hooks.SessionStart = [];
  hooks.SessionStart.push({
    matcher: "",
    hooks: [{ type: "command", command: getHookCommand("session-hook"), timeout: 5000 }],
  });

  // Add Stop hook — authoritative idle signal when Claude finishes responding
  if (!hooks.Stop) hooks.Stop = [];
  hooks.Stop.push({
    matcher: "",
    hooks: [{ type: "command", command: getHookCommand("state-hook"), timeout: 5000 }],
  });

  // Add UserPromptSubmit hook — intercepts /discord commands before Claude sees them
  if (!hooks.UserPromptSubmit) hooks.UserPromptSubmit = [];
  hooks.UserPromptSubmit.push({
    matcher: "",
    hooks: [{ type: "command", command: getHookCommand("discord-hook"), timeout: 5000 }],
  });

  settings.hooks = hooks;

  fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
  fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + "\n");
}

function uninstallHooksAndStatusline() {
  // Remove skill
  const skillDir = getSkillDir();
  fs.rmSync(skillDir, { recursive: true, force: true });
  // Remove old /discord skill if it exists (migration from discord-rc)
  const oldSkillDir = path.join(os.homedir(), ".claude", "skills", "discord");
  fs.rmSync(oldSkillDir, { recursive: true, force: true });

  // Remove hooks + statusline from settings
  const settingsPath = getClaudeSettingsPath();
  let settings: Record<string, unknown>;
  try {
    settings = JSON.parse(fs.readFileSync(settingsPath, "utf-8"));
  } catch {
    return;
  }

  // Remove statusline
  const statusLine = settings.statusLine as Record<string, string> | undefined;
  if (statusLine?.command?.includes("statusline")) {
    delete settings.statusLine;
  }

  // Remove claude-remote hooks
  const hooks = settings.hooks as Record<string, unknown[]> | undefined;
  if (hooks) {
    removeAllRemoteHooks(hooks);
    if (Object.keys(hooks).length === 0) delete settings.hooks;
  }

  fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + "\n");
}

// ── Shell alias management ──

const ALIAS_MARKER = "# claude-remote-alias";

type ShellType = "powershell" | "pwsh" | "gitbash" | "cmd" | "bash" | "zsh" | "fish";

interface AliasTarget {
  shell: ShellType;
  profilePath: string;
  aliasLine: string;
  description: string;
}

function getAliasTargets(): AliasTarget[] {
  const targets: AliasTarget[] = [];
  const home = os.homedir();

  if (platform.getPlatform() === 'win32') {
    // Windows: PowerShell 5, PowerShell 7, Git Bash, CMD
    try {
      const psProfile = execSync('powershell -NoProfile -Command "echo $PROFILE"', { encoding: "utf-8", stdio: ["pipe", "pipe", "ignore"] }).trim();
      if (psProfile) {
        targets.push({
          shell: "powershell",
          profilePath: psProfile,
          aliasLine: `function claude { claude-remote @args } ${ALIAS_MARKER}`,
          description: "PowerShell 5",
        });
      }
    } catch { /* not available */ }

    try {
      const pwshProfile = execSync('pwsh -NoProfile -Command "echo $PROFILE"', { encoding: "utf-8", stdio: ["pipe", "pipe", "ignore"] }).trim();
      if (pwshProfile) {
        targets.push({
          shell: "pwsh",
          profilePath: pwshProfile,
          aliasLine: `function claude { claude-remote @args } ${ALIAS_MARKER}`,
          description: "PowerShell 7",
        });
      }
    } catch { /* not available */ }

    // Git Bash
    targets.push({
      shell: "gitbash",
      profilePath: path.join(home, ".bashrc"),
      aliasLine: `claude() { claude-remote "$@"; } ${ALIAS_MARKER}`,
      description: "Git Bash",
    });

    // CMD shim
    targets.push({
      shell: "cmd",
      profilePath: path.join(home, ".local", "bin", "claude.cmd"),
      aliasLine: "@echo off\nclaude-remote %*",
      description: "CMD",
    });
  } else {
    // Linux/macOS: detect shells using $SHELL and file existence with preference ordering
    const SHELL = process.env.SHELL || '';
    const detectedShells = new Set<string>();

    // Primary: $SHELL indicates user's default shell
    if (SHELL.includes('bash')) detectedShells.add('bash');
    else if (SHELL.includes('zsh')) detectedShells.add('zsh');
    else if (SHELL.includes('fish')) detectedShells.add('fish');

    // Fallback: check config file existence, prefer interactive over login
    const home = os.homedir();
    const bashrc = path.join(home, '.bashrc');
    const profile = path.join(home, '.profile');
    const bashProfile = path.join(home, '.bash_profile');
    const zshrc = path.join(home, '.zshrc');
    const zprofile = path.join(home, '.zprofile');
    const fishConfig = path.join(home, '.config', 'fish', 'config.fish');

    // Only add if not already detected via $SHELL; prefer .bashrc over .profile, .zshrc over .zprofile
    if (!detectedShells.has('bash')) {
      if (fs.existsSync(bashrc)) detectedShells.add('bash');
      else if (fs.existsSync(profile)) detectedShells.add('bash');
      else if (fs.existsSync(bashProfile)) detectedShells.add('bash');
    }
    if (!detectedShells.has('zsh')) {
      if (fs.existsSync(zshrc)) detectedShells.add('zsh');
      else if (fs.existsSync(zprofile)) detectedShells.add('zsh');
    }
    if (!detectedShells.has('fish')) {
      if (fs.existsSync(fishConfig)) detectedShells.add('fish');
    }

    // Build targets from detectedShells, selecting appropriate file per shell
    for (const shell of detectedShells) {
      let targetPath: string | null = null;
      let aliasLine: string = '';
      const desc = shell === 'bash' ? 'Bash' : shell === 'zsh' ? 'Zsh' : 'Fish';

      switch (shell) {
        case 'bash':
          // Prefer .bashrc, fallback to .profile or .bash_profile whichever exists
          if (fs.existsSync(bashrc)) targetPath = bashrc;
          else if (fs.existsSync(profile)) targetPath = profile;
          else if (fs.existsSync(bashProfile)) targetPath = bashProfile;
          aliasLine = `alias claude='claude-remote' ${ALIAS_MARKER}`;
          break;
        case 'zsh':
          if (fs.existsSync(zshrc)) targetPath = zshrc;
          else if (fs.existsSync(zprofile)) targetPath = zprofile;
          aliasLine = `alias claude='claude-remote' ${ALIAS_MARKER}`;
          break;
        case 'fish':
          targetPath = fishConfig;
          aliasLine = `function claude; claude-remote $argv; end ${ALIAS_MARKER}`;
          break;
      }

      if (targetPath && fs.existsSync(targetPath)) {
        targets.push({
          shell: shell as 'bash' | 'zsh' | 'fish',
          profilePath: targetPath,
          aliasLine,
          description: desc,
        });
      }
    }
  }

  return targets;
}

function installAlias(target: AliasTarget): void {
  if (target.shell === "cmd") {
    const shimDir = path.dirname(target.profilePath);
    try {
      fs.mkdirSync(shimDir, { recursive: true });
    } catch (err) {
      console.error(`[cli] Failed to create shim directory ${shimDir}: ${err instanceof Error ? err.message : err}`);
      throw err;
    }
    try {
      fs.writeFileSync(target.profilePath, target.aliasLine + "\n");
    } catch (err) {
      console.error(`[cli] Failed to write shim file ${target.profilePath}: ${err instanceof Error ? err.message : err}`);
      throw err;
    }
    ensureCmdShimInPath(shimDir);
    return;
  }

  // PowerShell / Git Bash — append to profile if not already present
  let content = "";
  try {
    content = fs.readFileSync(target.profilePath, "utf-8");
  } catch { /* file doesn't exist yet */ }

  if (content.includes(ALIAS_MARKER)) return;

  const profileDir = path.dirname(target.profilePath);
  try {
    fs.mkdirSync(profileDir, { recursive: true });
  } catch (err) {
    console.error(`[cli] Failed to create profile directory ${profileDir}: ${err instanceof Error ? err.message : err}`);
    throw err;
  }
  try {
    fs.appendFileSync(target.profilePath, "\n" + target.aliasLine + "\n");
  } catch (err) {
    console.error(`[cli] Failed to append to ${target.profilePath}: ${err instanceof Error ? err.message : err}`);
    throw err;
  }
}

function uninstallAlias(target: AliasTarget): void {
  if (target.shell === "cmd") {
    try {
      if (fs.existsSync(target.profilePath)) fs.unlinkSync(target.profilePath);
    } catch { /* best effort */ }
    return;
  }

  try {
    const content = fs.readFileSync(target.profilePath, "utf-8");
    const lines = content.split("\n").filter((line) => !line.includes(ALIAS_MARKER));
    fs.writeFileSync(target.profilePath, lines.join("\n"));
  } catch { /* file doesn't exist */ }
}

function ensureCmdShimInPath(shimDir: string): void {
  try {
    const userPath = execSync(
      'powershell -NoProfile -Command "[Environment]::GetEnvironmentVariable(\'PATH\', \'User\')"',
      { encoding: "utf-8", stdio: ["pipe", "pipe", "ignore"] }
    ).trim();
    if (!userPath.toLowerCase().includes(shimDir.toLowerCase())) {
      // Use PowerShell -EncodedCommand to safely pass paths with special characters
      // PowerShell expects base64-encoded UTF-16LE (Unicode) for -EncodedCommand
      const newPath = `${userPath};${shimDir}`;
      const script = `[Environment]::SetEnvironmentVariable('PATH', '${newPath.replace(/'/g, "''")}', 'User')`;
      const encoded = Buffer.from(script, 'utf-16le').toString('base64');
      execSync(
        `powershell -NoProfile -EncodedCommand ${encoded}`,
        { stdio: "ignore" }
      );
    }
  } catch { /* best effort */ }
}

// ── Discord API helpers ──

const API = "https://discord.com/api/v10";

async function discordFetch(token: string, endpoint: string, options?: RequestInit) {
  const res = await fetch(`${API}${endpoint}`, {
    ...options,
    headers: {
      Authorization: `Bot ${token}`,
      "Content-Type": "application/json",
      ...options?.headers,
    },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Discord API ${res.status}: ${text}`);
  }
  return res.json();
}

async function validateToken(token: string): Promise<{ valid: boolean; username?: string; id?: string }> {
  try {
    const data = await discordFetch(token, "/users/@me") as { username: string; id: string };
    return { valid: true, username: data.username, id: data.id };
  } catch {
    return { valid: false };
  }
}

async function fetchGuilds(token: string): Promise<Array<{ id: string; name: string }>> {
  return discordFetch(token, "/users/@me/guilds") as Promise<Array<{ id: string; name: string }>>;
}

async function createCategory(token: string, guildId: string, name: string): Promise<{ id: string; name: string }> {
  return discordFetch(token, `/guilds/${guildId}/channels`, {
    method: "POST",
    body: JSON.stringify({ name, type: 4 }),
  }) as Promise<{ id: string; name: string }>;
}

async function findExistingCategory(token: string, guildId: string, name: string): Promise<{ id: string; name: string } | null> {
  const channels = await discordFetch(token, `/guilds/${guildId}/channels`) as Array<{ id: string; name: string; type: number }>;
  return channels.find((c) => c.type === 4 && c.name.toLowerCase() === name.toLowerCase()) || null;
}

// ── Commands ──

async function setup() {
  p.intro(pc.bgCyan(pc.black(" claude-remote ")));

  const existing = loadConfig();

  if (existing) {
    p.log.info("Existing configuration found. Press Enter to keep current values.");
  }

  // Collect additional claude args early (may be used in later tasks)
  let additionalArgs: string[] = [];

  // ── Prerequisites note ──

  p.note(
    [
      `1. Go to ${pc.cyan("https://discord.com/developers/applications")}`,
      `2. Create a New Application ${pc.dim("→")} Bot tab ${pc.dim("→")} copy token`,
      `3. Enable ${pc.bold("Message Content Intent")}`,
      `4. OAuth2 ${pc.dim("→")} bot scope ${pc.dim("→")} Send Messages, Manage Channels`,
      `5. Invite the bot to your server`,
    ].join("\n"),
    "Prerequisites"
  );

  // ── Collect credentials ──

  const token = await p.password({
    message: "Paste your Discord Bot Token",
    mask: "•",
    validate(value) {
      if (!value && !existing?.discordBotToken) return "Bot token is required";
    },
  });

  if (p.isCancel(token)) {
    p.cancel("Setup cancelled.");
    process.exit(0);
  }

  const finalToken = token || existing?.discordBotToken || "";

  // ── Run install tasks on the timeline ──

  let botUsername = "";
  let guildId = "";
  let guilds: Array<{ id: string; name: string }> = [];
  let categoryId = "";

  await tasks([
    {
      title: "Validating bot token",
      task: async (message) => {
        message("Connecting to Discord...");
        const result = await validateToken(finalToken);
        if (!result.valid) {
          throw new Error("Invalid bot token");
        }
        botUsername = result.username!;
        return `Authenticated as ${pc.green(botUsername)}`;
      },
    },
    {
      title: "Fetching servers",
      task: async (message) => {
        message("Loading server list...");
        guilds = await fetchGuilds(finalToken);
        if (guilds.length === 0) {
          throw new Error("Bot is not in any servers. Invite it first.");
        }
        return `Found ${pc.green(String(guilds.length))} server(s)`;
      },
    },
  ]);

  // ── Pick server (interactive — outside tasks) ──

  if (guilds.length === 1) {
    guildId = guilds[0].id;
    p.log.step(`Server: ${pc.green(guilds[0].name)}`);
  } else {
    const selected = await p.select({
      message: "Which server should Claude Remote use?",
      options: guilds.map((g) => ({ value: g.id, label: g.name })),
    });

    if (p.isCancel(selected)) {
      p.cancel("Setup cancelled.");
      process.exit(0);
    }
    guildId = selected;
  }

  // ── Additional claude arguments (configs) ──

  const addCustomArgs = await p.confirm({
    message: 'Add custom CLI arguments to the claude process? (e.g., --dangerously-skip-permissions, --model stepfun/step-3.5-flash:free)',
    initialValue: false,
  });

  if (!p.isCancel(addCustomArgs) && addCustomArgs) {
    const argsInput = await p.text({
      message: 'Enter additional arguments (space-separated):',
      placeholder: '--dangerously-skip-permissions --model stepfun/step-3.5-flash:free',
      validate: (value: string | undefined) => {
        if (!value || !value.trim()) return 'At least one argument required if enabled';
        return undefined;
      },
    });

    if (!p.isCancel(argsInput)) {
      additionalArgs = argsInput.trim().split(/\s+/).filter(Boolean);
    }
  }

  // ── Alias setup ──

  const aliasSetup = await p.confirm({
    message: `Set up ${pc.cyan("claude")} alias? (so you type ${pc.bold("claude")} instead of ${pc.bold("claude-remote")})`,
    initialValue: false, // default to false to avoid surprising users
  });

  // ── Continue install tasks ──

  const CATEGORY_NAME = "Claude RC";

  await tasks([
    {
      title: `Setting up "${CATEGORY_NAME}" category`,
      task: async (message) => {
        message("Checking for existing category...");
        const existing = await findExistingCategory(finalToken, guildId, CATEGORY_NAME);

        if (existing) {
          categoryId = existing.id;
          return `Found existing category ${pc.green(existing.name)}`;
        }

        message("Creating category...");
        const created = await createCategory(finalToken, guildId, CATEGORY_NAME);
        categoryId = created.id;
        return `Created category ${pc.green(created.name)}`;
      },
    },
    {
      title: "Saving configuration",
      task: async () => {
        const config: Config = {
          discordBotToken: finalToken,
          guildId,
          categoryId,
        };
        if (additionalArgs.length > 0) {
          config.additionalClaudeArgs = additionalArgs;
        }
        saveConfig(config);
        return `Saved to ${pc.dim(CONFIG_FILE)}`;
      },
    },
    {
      title: "Installing /remote skill, hooks & statusline",
      task: async (message) => {
        message("Configuring skill, hooks & statusline...");
        installHooksAndStatusline();
        return "/remote skill, SessionStart hook & statusline installed";
      },
    },
  ]);

  if (!p.isCancel(aliasSetup) && aliasSetup) {
    let targets = getAliasTargets();

    // If multiple shells detected, prompt user to select which to install to
    if (targets.length > 1) {
      const selected = await p.multiselect({
        message: 'Install claude alias to:',
        options: targets.map(t => ({ value: t.shell, label: `${t.description} (${t.profilePath})` })),
        initialValues: targets.map(t => t.shell),
      });

      if (p.isCancel(selected)) {
        p.cancel("Setup cancelled.");
        process.exit(0);
      }

      // Filter to only selected shells
      targets = targets.filter(t => selected.includes(t.shell));
    }

    if (targets.length === 0) {
      p.log.warning("No shell profiles detected. Please create ~/.bashrc, ~/.zshrc, or fish config manually.");
    } else {
      await tasks(
        targets.map((target) => ({
          title: `${target.description} alias`,
          task: async () => {
            installAlias(target);
            return `Installed → ${pc.dim(target.profilePath)}`;
          },
        }))
      );

      if (process.platform === "win32" && targets.some((t) => t.shell === "cmd")) {
        p.log.info(`CMD: added ${pc.dim("claude.cmd")} shim to ${pc.dim("~/.local/bin")}`);
      }

      p.log.info(`Restart your terminal for the ${pc.cyan("claude")} alias to take effect.`);
    }
  }

  // ── Summary ──

  const guildName = guilds.find((g) => g.id === guildId)?.name || guildId;
  const cmdName = (!p.isCancel(aliasSetup) && aliasSetup) ? "claude" : "claude-remote";

  p.note(
    [
      `${pc.cyan(cmdName)}${" ".repeat(Math.max(1, 20 - cmdName.length))}Start Claude Code with RC support`,
      `${pc.cyan("/remote on")}            Enable sync (inside a session)`,
      `${pc.cyan("/remote off")}           Disable sync`,
      "",
      `Bot      ${pc.green(botUsername)}`,
      `Server   ${pc.green(guildName)}`,
      `Category ${pc.green(CATEGORY_NAME)}`,
      "",
      pc.dim("Each /remote on creates a new channel under the category."),
    ].join("\n"),
    "Ready to go!"
  );

  p.outro(pc.green("Setup complete!"));
}

async function uninstall() {
  p.intro(pc.bgRed(pc.white(" claude-remote uninstall ")));

  const confirmed = await p.confirm({
    message: "Remove Claude Remote configuration and Claude Code hook?",
    initialValue: false,
  });

  if (p.isCancel(confirmed) || !confirmed) {
    p.cancel("Uninstall cancelled.");
    process.exit(0);
  }

  const uninstallNpm = await p.confirm({
    message: "Also uninstall the npm package (@hoangvu12/claude-remote)?",
    initialValue: false,
  });

  const uninstallTasks = [
    {
      title: "Removing /remote skill, hooks & statusline",
      task: async () => {
        uninstallHooksAndStatusline();
        return "Skill, hooks & statusline removed";
      },
    },
    {
      title: "Removing claude alias",
      task: async () => {
        const targets = getAliasTargets();
        let removed = 0;
        for (const target of targets) {
          try {
            uninstallAlias(target);
            removed++;
          } catch { /* best effort */ }
        }
        return removed > 0 ? `Removed from ${removed} shell(s)` : "No aliases found";
      },
    },
    {
      title: "Removing configuration",
      task: async () => {
        fs.rmSync(CONFIG_DIR, { recursive: true, force: true });
        return "Configuration removed";
      },
    },
  ];

  // Add npm uninstall task if user opted in
  if (!p.isCancel(uninstallNpm) && uninstallNpm) {
    uninstallTasks.push({
      title: "Uninstalling npm package",
      task: async () => {
        try {
          execSync(`npm uninstall -g ${PKG_NAME}`, {
            stdio: ["pipe", "pipe", "pipe"],
          });
          return "npm package removed";
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          if (msg.includes("EACCES") || msg.includes("permission")) {
            throw new Error(`Permission denied. Try: sudo npm uninstall -g ${PKG_NAME}`);
          } else if (msg.includes("not found") || msg.includes("ENOENT")) {
            throw new Error("Package not found (may have been already removed)");
          } else {
            throw new Error(`Uninstall failed: ${msg}`);
          }
        }
      },
    });
  }

  await tasks(uninstallTasks);

  if (!p.isCancel(uninstallNpm) || uninstallNpm) {
    p.outro(pc.green("Uninstalled successfully."));
  } else {
    p.note(
      `You can also run: ${pc.bold("npm uninstall -g @hoangvu12/claude-remote")}`,
      "Optional cleanup"
    );
    p.outro(pc.green("Uninstalled successfully (npm package retained)."));
  }
}

// ── Auto-update ──

interface UpdateCache {
  lastCheck: number;
  latestVersion: string;
}

function compareVersions(a: string, b: string): number {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] || 0) > (pb[i] || 0)) return 1;
    if ((pa[i] || 0) < (pb[i] || 0)) return -1;
  }
  return 0;
}

function readUpdateCache(): UpdateCache | null {
  try {
    return JSON.parse(fs.readFileSync(UPDATE_CACHE, "utf-8"));
  } catch {
    return null;
  }
}

function writeUpdateCache(cache: UpdateCache) {
  try {
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
    fs.writeFileSync(UPDATE_CACHE, JSON.stringify(cache));
  } catch { /* best effort */ }
}

/** Detect if running from a local dev checkout (npm link / symlink) */
function isLocalDev(): boolean {
  try {
    const realPath = fs.realpathSync(import.meta.dirname);
    // npm link: the real path won't be inside a global node_modules
    return !realPath.includes("node_modules");
  } catch {
    return false;
  }
}

/**
 * Non-blocking update check: queries npm registry, writes latest version to cache.
 * The statusline reads the cache and shows a notice if newer version exists.
 */
function checkForUpdates() {
  const cache = readUpdateCache();
  const now = Date.now();

  // Skip if checked recently
  if (cache && now - cache.lastCheck < CHECK_INTERVAL) {
    return;
  }

  // Fire and forget — don't await
  fetch(`https://registry.npmjs.org/${PKG_NAME}/latest`, {
    signal: AbortSignal.timeout(5000),
  })
    .then((res) => res.json())
    .then((data: { version?: string }) => {
      const latest = data.version;
      if (!latest) return;

      writeUpdateCache({ lastCheck: now, latestVersion: latest });
    })
    .catch(() => {
      // Network error, offline, etc. — silently ignore
    });
}

/** Self-update: install the latest version from npm */
async function selfUpdate() {
  p.intro(pc.bgCyan(pc.black(" claude-remote update ")));

  const s = p.spinner();
  s.start("Checking for updates...");

  let latest: string;
  try {
    const res = await fetch(`https://registry.npmjs.org/${PKG_NAME}/latest`, {
      signal: AbortSignal.timeout(10000),
    });
    const data = await res.json() as { version?: string };
    latest = data.version || "";
    if (!latest) throw new Error("No version found");
  } catch {
    s.stop("Failed to check for updates");
    p.log.error("Could not reach npm registry. Check your internet connection.");
    process.exit(1);
  }

  if (compareVersions(latest, PKG_VERSION) <= 0) {
    s.stop(`Already on latest version ${pc.green(PKG_VERSION)}`);
    p.outro("");
    return;
  }

  s.message(`Installing ${pc.green(latest)}...`);

  try {
    execSync(`npm install -g ${PKG_NAME}@${latest}`, {
      stdio: ["pipe", "pipe", "pipe"],
      timeout: 60000,
    });
    writeUpdateCache({ lastCheck: Date.now(), latestVersion: latest });
    s.stop(`Updated ${pc.dim(PKG_VERSION)} → ${pc.green(latest)}`);
    p.outro(pc.green("Restart your terminal to use the new version."));
  } catch (err) {
    s.stop("Update failed");
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("EACCES") || msg.includes("permission")) {
      p.log.error(`Permission denied. Try: ${pc.bold(`sudo npm install -g ${PKG_NAME}@${latest}`)}`);
    } else {
      p.log.error(`Install failed: ${msg}`);
      p.log.info(`You can update manually: ${pc.bold(`npm install -g ${PKG_NAME}@${latest}`)}`);
    }
    process.exit(1);
  }
}

async function run() {
  let config = loadConfig();
  if (!config) {
    // First-run auto-setup: launch interactive configuration wizard
    p.intro(pc.bgYellow(pc.black(" claude-remote ")));
    p.log.info("First run detected — let's set things up!");
    await setup();
    // After setup, config should exist; reload
    config = loadConfig();
    if (!config) {
      // Setup was cancelled or failed
      process.exit(1);
    }
  }

  process.env.DISCORD_BOT_TOKEN = config.discordBotToken;
  process.env.DISCORD_GUILD_ID = config.guildId;
  process.env.DISCORD_CATEGORY_ID = config.categoryId;

  // Ensure hooks & skill are up to date (idempotent, handles post-update registration)
  installHooksAndStatusline();

  // Check for updates in background (non-blocking, skip if locally linked)
  if (!isLocalDev()) checkForUpdates();

  await import("./rc.js");
}

// ── Main ──

const command = process.argv[2];

switch (command) {
  case "setup":
    await setup();
    break;
  case "uninstall":
    await uninstall();
    break;
  case "update":
    await selfUpdate();
    break;
  case undefined:
  case "start":
    await run();
    break;
  case "help":
  case "--help":
  case "-h":
    console.log(`
  ${pc.bold("claude-remote")} — Remote Control for Claude Code

  ${pc.dim("Commands:")}
    ${pc.cyan("claude-remote")}              Start Claude Code with remote control
    ${pc.cyan("claude-remote setup")}        Configure provider, install hook
    ${pc.cyan("claude-remote update")}       Update to the latest version
    ${pc.cyan("claude-remote uninstall")}    Remove hook and config
    ${pc.cyan("claude-remote help")}         Show this help
`);
    break;
  case "--version":
    console.log(PKG_VERSION);
    break;
  default:
    await run();
    break;
}
