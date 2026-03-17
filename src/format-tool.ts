import path from "node:path";
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
      lines.push("```diff");
      const oldLines = oldStr.split("\n");
      const newLines = newStr.split("\n");
      let commonStart = 0;
      while (commonStart < oldLines.length && commonStart < newLines.length && oldLines[commonStart] === newLines[commonStart]) {
        commonStart++;
      }
      let commonEnd = 0;
      while (commonEnd < oldLines.length - commonStart && commonEnd < newLines.length - commonStart && oldLines[oldLines.length - 1 - commonEnd] === newLines[newLines.length - 1 - commonEnd]) {
        commonEnd++;
      }
      const removedLines = oldLines.slice(commonStart, oldLines.length - commonEnd);
      const addedLines = newLines.slice(commonStart, newLines.length - commonEnd);
      for (let i = 0; i < commonStart; i++) lines.push(`  ${oldLines[i]}`);
      for (let i = 0; i < Math.max(removedLines.length, addedLines.length); i++) {
        const oldL = i < removedLines.length ? removedLines[i] : null;
        const newL = i < addedLines.length ? addedLines[i] : null;
        if (oldL !== null) lines.push(`- ${oldL}`);
        if (newL !== null) lines.push(`+ ${newL}`);
      }
      for (let i = oldLines.length - commonEnd; i < oldLines.length; i++) lines.push(`  ${oldLines[i]}`);
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
