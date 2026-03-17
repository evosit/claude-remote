import path from "node:path";
import { readFileSync } from "node:fs";
import type { ProcessedMessage } from "./types.js";
import type { OutgoingMessage } from "./provider.js";

// ── Language detection from file extension ──

const EXT_TO_LANG: Record<string, string> = {
  ".ts": "ts", ".tsx": "tsx", ".js": "js", ".jsx": "jsx",
  ".py": "py", ".rb": "rb", ".rs": "rs", ".go": "go",
  ".java": "java", ".kt": "kotlin", ".c": "c", ".cpp": "cpp",
  ".h": "c", ".hpp": "cpp", ".cs": "cs", ".swift": "swift",
  ".sh": "bash", ".bash": "bash", ".zsh": "bash",
  ".json": "json", ".yaml": "yaml", ".yml": "yaml", ".toml": "toml",
  ".xml": "xml", ".html": "html", ".css": "css", ".scss": "scss",
  ".sql": "sql", ".md": "md", ".lua": "lua", ".php": "php",
  ".r": "r", ".dart": "dart", ".zig": "zig", ".ex": "elixir",
  ".exs": "elixir", ".erl": "erlang", ".hs": "haskell",
  ".ml": "ocaml", ".vim": "vim", ".dockerfile": "dockerfile",
};

function langFromPath(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  if (ext) return EXT_TO_LANG[ext] || "";
  const base = path.basename(filePath).toLowerCase();
  if (base === "dockerfile") return "dockerfile";
  if (base === "makefile") return "makefile";
  return "";
}

// ── LCS-based diff ──

const CONTEXT_LINES = 2;

/** Find the 1-based line number where `needle` first appears in a file */
function findStartLine(filePath: string, needle: string): number {
  try {
    const content = readFileSync(filePath, "utf-8");
    const idx = content.indexOf(needle);
    if (idx === -1) return 1;
    return content.slice(0, idx).split("\n").length;
  } catch {
    return 1;
  }
}

/** Compute a minimal unified diff between old and new line arrays */
function computeDiff(oldLines: string[], newLines: string[], startLine = 1): string[] {
  const m = oldLines.length;
  const n = newLines.length;

  // LCS dynamic programming (guard against huge inputs)
  if (m * n > 90_000) return fallbackDiff(oldLines, newLines, startLine);

  const dp: number[][] = [];
  for (let i = 0; i <= m; i++) {
    dp[i] = new Array(n + 1).fill(0);
  }
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] =
        oldLines[i - 1] === newLines[j - 1]
          ? dp[i - 1][j - 1] + 1
          : Math.max(dp[i - 1][j], dp[i][j - 1]);
    }
  }

  // Backtrack to build operation list
  type Op = { type: " " | "-" | "+"; line: string };
  const ops: Op[] = [];
  let i = m,
    j = n;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && oldLines[i - 1] === newLines[j - 1]) {
      ops.push({ type: " ", line: oldLines[i - 1] });
      i--;
      j--;
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      ops.push({ type: "+", line: newLines[j - 1] });
      j--;
    } else {
      ops.push({ type: "-", line: oldLines[i - 1] });
      i--;
    }
  }
  ops.reverse();

  // Reorder each changed hunk: all removals before additions
  const reordered: Op[] = [];
  let k = 0;
  while (k < ops.length) {
    if (ops[k].type === " ") {
      reordered.push(ops[k++]);
    } else {
      const removed: Op[] = [];
      const added: Op[] = [];
      while (k < ops.length && ops[k].type !== " ") {
        if (ops[k].type === "-") removed.push(ops[k]);
        else added.push(ops[k]);
        k++;
      }
      reordered.push(...removed, ...added);
    }
  }

  // Assign line numbers to each op
  type NumberedOp = { type: " " | "-" | "+"; line: string; num: number };
  const numbered: NumberedOp[] = [];
  let oldNum = startLine;
  let newNum = startLine;
  for (const op of reordered) {
    if (op.type === " ") {
      numbered.push({ ...op, num: oldNum });
      oldNum++;
      newNum++;
    } else if (op.type === "-") {
      numbered.push({ ...op, num: oldNum });
      oldNum++;
    } else {
      numbered.push({ ...op, num: newNum });
      newNum++;
    }
  }

  // Find max line number for padding
  const maxNum = numbered.length ? Math.max(...numbered.map((o) => o.num)) : 0;
  const pad = String(maxNum).length;

  // Mark which ops are visible (changes + context around them)
  const isChange = numbered.map((op) => op.type !== " ");
  const visible = new Array(numbered.length).fill(false);
  for (let idx = 0; idx < numbered.length; idx++) {
    if (isChange[idx]) {
      for (
        let c = Math.max(0, idx - CONTEXT_LINES);
        c <= Math.min(numbered.length - 1, idx + CONTEXT_LINES);
        c++
      ) {
        visible[c] = true;
      }
    }
  }

  // Build output with collapsed unchanged regions
  const lines: string[] = [];
  let inCollapse = false;
  for (let idx = 0; idx < numbered.length; idx++) {
    if (!visible[idx]) {
      if (!inCollapse) {
        lines.push(" ...");
        inCollapse = true;
      }
    } else {
      inCollapse = false;
      const { type, line, num } = numbered[idx];
      const n = String(num).padStart(pad);
      // +/- must be first char for Discord diff syntax highlighting
      if (type === " ") {
        lines.push(`  ${n} ${line}`);
      } else {
        lines.push(`${type} ${n} ${line}`);
      }
    }
  }
  return lines;
}

/** Simple prefix/suffix fallback for very large diffs */
function fallbackDiff(oldLines: string[], newLines: string[], startLine = 1): string[] {
  let commonStart = 0;
  while (
    commonStart < oldLines.length &&
    commonStart < newLines.length &&
    oldLines[commonStart] === newLines[commonStart]
  )
    commonStart++;
  let commonEnd = 0;
  while (
    commonEnd < oldLines.length - commonStart &&
    commonEnd < newLines.length - commonStart &&
    oldLines[oldLines.length - 1 - commonEnd] ===
      newLines[newLines.length - 1 - commonEnd]
  )
    commonEnd++;

  const maxNum = startLine + Math.max(oldLines.length, newLines.length) - 1;
  const pad = String(maxNum).length;
  const ctx = (num: number, line: string) =>
    `  ${String(num).padStart(pad)} ${line}`;
  const rem = (num: number, line: string) =>
    `- ${String(num).padStart(pad)} ${line}`;
  const add = (num: number, line: string) =>
    `+ ${String(num).padStart(pad)} ${line}`;

  const lines: string[] = [];
  if (commonStart > 0) lines.push(" ...");
  const ctxBefore = Math.max(0, commonStart - CONTEXT_LINES);
  for (let i = ctxBefore; i < commonStart; i++)
    lines.push(ctx(startLine + i, oldLines[i]));

  let oldNum = startLine + commonStart;
  for (const l of oldLines.slice(commonStart, oldLines.length - commonEnd))
    lines.push(rem(oldNum++, l));
  let newNum = startLine + commonStart;
  for (const l of newLines.slice(commonStart, newLines.length - commonEnd))
    lines.push(add(newNum++, l));

  const ctxEnd = Math.min(oldLines.length, oldLines.length - commonEnd + CONTEXT_LINES);
  const ctxStartNum = startLine + oldLines.length - commonEnd;
  for (let i = oldLines.length - commonEnd; i < ctxEnd; i++)
    lines.push(ctx(ctxStartNum + (i - (oldLines.length - commonEnd)), oldLines[i]));
  if (commonEnd > 0) lines.push(" ...");
  return lines;
}

// ── Tool embed helper ──

export function toolEmbed(description: string, color?: number): OutgoingMessage {
  return {
    embed: { description: description.slice(0, 4000), color },
  };
}

// ── Format tool input as provider-agnostic messages ──

export function formatToolInput(pm: ProcessedMessage, embedColor?: number): OutgoingMessage[] {
  const input = pm.toolInput;
  const name = pm.toolName;

  const embed = (desc: string) => toolEmbed(desc, embedColor);

  if (name === "Edit" && input) {
    const filePath = String(input.file_path || "");
    const oldStr = String(input.old_string || "");
    const newStr = String(input.new_string || "");
    const lines: string[] = [`**Edit** \`${filePath}\``];
    if (oldStr || newStr) {
      const startLine = oldStr ? findStartLine(filePath, oldStr) : 1;
      lines.push("```diff");
      lines.push(...computeDiff(oldStr.split("\n"), newStr.split("\n"), startLine));
      lines.push("```");
    }
    return [embed(lines.join("\n"))];
  }

  if (name === "Write" && input) {
    const filePath = String(input.file_path || "");
    const lang = langFromPath(filePath);
    const fileContent = String(input.content || "");
    const preview = fileContent.slice(0, 1500);
    return [embed(`**Write** \`${filePath}\`\n\`\`\`${lang}\n${preview}${fileContent.length > 1500 ? "\n…" : ""}\n\`\`\``)];
  }

  if (name === "Read" && input) {
    const filePath = String(input.file_path || "");
    const parts = [`**Read** \`${filePath}\``];
    if (input.offset) parts.push(`lines ${input.offset}–${Number(input.offset) + Number(input.limit || 2000)}`);
    return [embed(parts.join(" "))];
  }

  if (name === "Bash" && input) {
    return [embed(`**Bash**\n\`\`\`bash\n${String(input.command || "").slice(0, 1800)}\n\`\`\``)];
  }

  if (name === "Agent" && input) {
    const desc = String(input.description || "");
    const prompt = String(input.prompt || "").slice(0, 1500);
    return [embed(`**Agent** ${desc}\n\`\`\`\n${prompt}${String(input.prompt || "").length > 1500 ? "\n…" : ""}\n\`\`\``)];
  }

  if (name === "Grep" && input) {
    const parts = [`**Grep** \`${input.pattern}\``];
    if (input.path) parts.push(`in \`${input.path}\``);
    if (input.glob) parts.push(`(${input.glob})`);
    return [embed(parts.join(" "))];
  }

  if (name === "Glob" && input) {
    return [embed(`**Glob** \`${input.pattern}\``)];
  }

  return [embed(`**${name}** ${pm.content}`)];
}
