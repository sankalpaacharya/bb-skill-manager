// Minimal SKILL.md frontmatter reader for the fields the Agent Skills spec
// requires (`name`, `description`) plus the optional ones we display.
import * as fs from "node:fs";
import * as path from "node:path";

export interface Frontmatter {
  name?: string;
  description?: string;
  license?: string;
  compatibility?: string;
}

const FIELDS = new Set<keyof Frontmatter>(["name", "description", "license", "compatibility"]);

export function parseFrontmatter(text: string): Frontmatter {
  if (!text.startsWith("---")) return {};
  const end = text.indexOf("\n---", 3);
  if (end === -1) return {};
  const result: Frontmatter = {};
  for (const line of text.slice(3, end).split("\n")) {
    const match = /^([a-z-]+):\s*(.*)$/.exec(line);
    if (match === null) continue;
    const key = match[1] as keyof Frontmatter;
    if (!FIELDS.has(key)) continue;
    result[key] = match[2].trim().replace(/^["']|["']$/g, "");
  }
  return result;
}

export function readFrontmatter(skillDir: string): Frontmatter {
  try {
    return parseFrontmatter(fs.readFileSync(path.join(skillDir, "SKILL.md"), "utf8"));
  } catch {
    return {};
  }
}

export function hasSkillMd(dir: string): boolean {
  try {
    return fs.statSync(path.join(dir, "SKILL.md")).isFile();
  } catch {
    return false;
  }
}
