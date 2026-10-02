// Skills shipped by Claude Code plugins. Claude Code's plugin manager owns
// them, so the scan lists them read-only and never writes to them.
import * as fs from "node:fs";
import * as path from "node:path";
import { hasSkillMd } from "./frontmatter";
import { isDirectory } from "./paths";

export interface PluginSkill {
  /** `<plugin>@<marketplace>`, the key Claude Code uses in installed_plugins.json. */
  pluginId: string;
  version?: string;
  /** `<plugin>:<dir basename>`, how Claude Code namespaces plugin skills. */
  name: string;
  dir: string;
}

function readJson(file: string): unknown {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return undefined;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Skill dirs a plugin ships: the manifest's `skills` list, else every dir under skills/. */
function skillDirs(installPath: string): string[] {
  const manifest = readJson(path.join(installPath, ".claude-plugin", "plugin.json"));
  if (isRecord(manifest) && Array.isArray(manifest.skills)) {
    return manifest.skills
      .filter((entry): entry is string => typeof entry === "string")
      .map((entry) => path.resolve(installPath, entry));
  }
  const skills = path.join(installPath, "skills");
  let entries: string[];
  try {
    entries = fs.readdirSync(skills);
  } catch {
    return [];
  }
  return entries.map((entry) => path.join(skills, entry)).filter(isDirectory);
}

/** Skills from every enabled, user-scoped Claude Code plugin under `root` (normally `~/.claude`). */
export function listPluginSkills(root: string): PluginSkill[] {
  const registry = readJson(path.join(root, "plugins", "installed_plugins.json"));
  if (!isRecord(registry) || !isRecord(registry.plugins)) return [];
  const settings = readJson(path.join(root, "settings.json"));
  const enabled = isRecord(settings) && isRecord(settings.enabledPlugins) ? settings.enabledPlugins : {};

  const skills: PluginSkill[] = [];
  for (const [pluginId, installs] of Object.entries(registry.plugins)) {
    if (enabled[pluginId] === false || !Array.isArray(installs)) continue;
    const plugin = pluginId.split("@")[0];
    for (const install of installs) {
      if (!isRecord(install) || install.scope !== "user" || typeof install.installPath !== "string") continue;
      const version = typeof install.version === "string" ? install.version : undefined;
      for (const dir of skillDirs(install.installPath)) {
        if (!hasSkillMd(dir)) continue;
        skills.push({ pluginId, ...(version !== undefined ? { version } : {}), name: `${plugin}:${path.basename(dir)}`, dir });
      }
    }
  }
  return skills.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}
