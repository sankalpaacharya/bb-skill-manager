import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { doctor } from "./doctor";
import { listPluginSkills } from "./plugins";
import { scanStatus } from "./scan";

let root: string;
let claudeRoot: string;

function writeSkill(dir: string, name: string) {
  const skillDir = path.join(dir, name);
  fs.mkdirSync(skillDir, { recursive: true });
  fs.writeFileSync(path.join(skillDir, "SKILL.md"), `---\nname: ${name}\ndescription: Test ${name}\n---\n# body\n`);
  return skillDir;
}

function installPlugin(id: string, version: string, scope: "user" | "local" = "user"): string {
  const installPath = path.join(claudeRoot, "plugins", "cache", id.replace("@", "-"), version);
  fs.mkdirSync(installPath, { recursive: true });
  const registryPath = path.join(claudeRoot, "plugins", "installed_plugins.json");
  const registry = fs.existsSync(registryPath) ? JSON.parse(fs.readFileSync(registryPath, "utf8")) : { version: 2, plugins: {} };
  registry.plugins[id] = [{ scope, installPath, version }];
  fs.writeFileSync(registryPath, JSON.stringify(registry));
  return installPath;
}

function writeSettings(enabledPlugins: Record<string, boolean>) {
  fs.writeFileSync(path.join(claudeRoot, "settings.json"), JSON.stringify({ enabledPlugins }));
}

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "skill-manager-plugins-"));
  claudeRoot = path.join(root, ".claude");
  fs.mkdirSync(path.join(claudeRoot, "plugins"), { recursive: true });
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

describe("listPluginSkills", () => {
  it("lists every SKILL.md dir under skills/ when the manifest names none", () => {
    const install = installPlugin("pstack@pstack-claude", "0.9.45");
    const poteto = writeSkill(path.join(install, "skills"), "poteto-mode");
    const how = writeSkill(path.join(install, "skills"), "how");
    fs.mkdirSync(path.join(install, "skills", "no-skill-md"));

    expect(listPluginSkills(claudeRoot)).toEqual([
      { pluginId: "pstack@pstack-claude", version: "0.9.45", name: "pstack:how", dir: how },
      { pluginId: "pstack@pstack-claude", version: "0.9.45", name: "pstack:poteto-mode", dir: poteto },
    ]);
  });

  it("resolves a manifest skills array with nested paths and ignores the default layout", () => {
    const install = installPlugin("mattpocock-skills@mattpocock", "1.2.0");
    const tdd = writeSkill(path.join(install, "skills", "engineering"), "tdd");
    writeSkill(path.join(install, "skills"), "not-listed");
    fs.mkdirSync(path.join(install, ".claude-plugin"), { recursive: true });
    fs.writeFileSync(
      path.join(install, ".claude-plugin", "plugin.json"),
      JSON.stringify({ name: "mattpocock-skills", skills: ["./skills/engineering/tdd", "./skills/engineering/absent"] }),
    );

    expect(listPluginSkills(claudeRoot)).toEqual([
      { pluginId: "mattpocock-skills@mattpocock", version: "1.2.0", name: "mattpocock-skills:tdd", dir: tdd },
    ]);
  });

  it("skips plugins that are not user scoped", () => {
    const install = installPlugin("cloudflare@claude-plugins-official", "1.0.0", "local");
    writeSkill(path.join(install, "skills"), "wrangler");

    expect(listPluginSkills(claudeRoot)).toEqual([]);
  });

  it("skips plugins disabled in settings.json and keeps the rest", () => {
    const off = installPlugin("off@market", "1");
    writeSkill(path.join(off, "skills"), "hidden");
    const on = installPlugin("on@market", "1");
    const shown = writeSkill(path.join(on, "skills"), "shown");
    writeSettings({ "off@market": false });

    expect(listPluginSkills(claudeRoot)).toEqual([{ pluginId: "on@market", version: "1", name: "on:shown", dir: shown }]);
  });

  it("returns nothing when the registry is missing or malformed", () => {
    expect(listPluginSkills(claudeRoot)).toEqual([]);
    fs.writeFileSync(path.join(claudeRoot, "plugins", "installed_plugins.json"), "{ not json");
    expect(listPluginSkills(claudeRoot)).toEqual([]);
  });
});

describe("scanStatus with plugin skills", () => {
  it("adds a read-only row with a plugin cell for claude and missing cells elsewhere", () => {
    const install = installPlugin("pstack@pstack-claude", "0.9.45");
    const dir = writeSkill(path.join(install, "skills"), "poteto-mode");
    const hub = path.join(root, "hub");
    fs.mkdirSync(hub);
    const claudeDir = path.join(claudeRoot, "skills");
    fs.mkdirSync(claudeDir);
    const codexDir = path.join(root, ".codex", "skills");

    const status = scanStatus({
      hub,
      agents: [
        { id: "claude", label: "Claude Code", dir: claudeDir },
        { id: "codex", label: "Codex", dir: codexDir, readsHub: true },
      ],
    });

    const row = status.skills.find((skill) => skill.name === "pstack:poteto-mode");
    expect(row).toBeDefined();
    expect(row?.inHub).toBe(false);
    expect(row?.description).toBe("Test poteto-mode");
    expect(row?.plugin).toEqual({ id: "pstack@pstack-claude", version: "0.9.45" });
    expect(row?.cells.claude.state).toBe("plugin");
    expect(row?.cells.claude.path).toBe(dir);
    expect(row?.cells.claude.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(row?.cells.codex).toEqual({ state: "missing", path: path.join(codexDir, "pstack:poteto-mode") });
    expect(doctor(status)).toEqual([]);
  });

  it("adds no plugin rows when no claude agent is scanned", () => {
    const install = installPlugin("pstack@pstack-claude", "0.9.45");
    writeSkill(path.join(install, "skills"), "poteto-mode");
    const hub = path.join(root, "hub");
    fs.mkdirSync(hub);

    const status = scanStatus({ hub, agents: [{ id: "codex", label: "Codex", dir: path.join(root, ".codex", "skills") }] });
    expect(status.skills.map((skill) => skill.name)).toEqual([]);
  });
});
