import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { discoverSkills, selectSkills } from "./fetch";
import { hashSkillDir } from "./hash";
import { installFromSource } from "./install";
import {
  lockfilePathForHub,
  parseLockfile,
  readLockfile,
  upsertLockEntry,
  writeLockfile,
} from "./lockfile";
import { parseSource, specFromLock } from "./source";
import { checkUpdates, updateSkills } from "./updates";

let root: string;
let hub: string;

function writeSkill(dir: string, name: string, body = "# body\n", extra: Record<string, string> = {}) {
  const skillDir = path.join(dir, name);
  fs.mkdirSync(skillDir, { recursive: true });
  fs.writeFileSync(path.join(skillDir, "SKILL.md"), `---\nname: ${name}\ndescription: Test ${name}\n---\n${body}`);
  for (const [file, content] of Object.entries(extra)) {
    fs.mkdirSync(path.dirname(path.join(skillDir, file)), { recursive: true });
    fs.writeFileSync(path.join(skillDir, file), content);
  }
  return skillDir;
}

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "skill-manager-prov-"));
  hub = path.join(root, "home", ".agents", "skills");
  fs.mkdirSync(hub, { recursive: true });
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

describe("hashSkillDir", () => {
  it("matches the Vercel skills CLI algorithm", () => {
    const dir = writeSkill(root, "s", "x\n", { "b/two.md": "2", "a.md": "1", "node_modules/x.js": "no" });
    const expected = createHash("sha256");
    const files: Array<[string, Buffer]> = [
      ["SKILL.md", fs.readFileSync(path.join(dir, "SKILL.md"))],
      ["a.md", Buffer.from("1")],
      ["b/two.md", Buffer.from("2")],
    ];
    // The CLI sorts with localeCompare, which puts "a.md" before "SKILL.md".
    for (const [rel, content] of files.sort((a, b) => a[0].localeCompare(b[0]))) {
      expected.update(rel);
      expected.update(content);
    }
    expect(hashSkillDir(dir)).toBe(expected.digest("hex"));
  });
});

describe("lockfile", () => {
  it("lives beside the .agents directory", () => {
    expect(lockfilePathForHub("/home/me/.agents/skills")).toBe("/home/me/skills-lock.json");
  });

  it("round-trips and preserves unknown keys", () => {
    const file = lockfilePathForHub(hub);
    writeLockfile(file, {
      version: 1,
      extra: "kept",
      skills: {
        zeta: { source: "o/r", sourceType: "github", skillPath: "skills/zeta/SKILL.md", computedHash: "a", custom: 1 },
        alpha: { source: "o/r", sourceType: "github", skillPath: "skills/alpha/SKILL.md", computedHash: "b" },
      },
    });
    const text = fs.readFileSync(file, "utf8");
    expect(text.indexOf('"alpha"')).toBeLessThan(text.indexOf('"zeta"'));
    const lock = readLockfile(file);
    expect(lock.extra).toBe("kept");
    expect(lock.skills.zeta.custom).toBe(1);
  });

  it("drops malformed entries instead of failing", () => {
    const lock = parseLockfile('{"version":1,"skills":{"ok":{"source":"a/b","sourceType":"github","skillPath":"x/SKILL.md","computedHash":"h"},"bad":{"source":1}}}');
    expect(Object.keys(lock.skills)).toEqual(["ok"]);
  });
});

describe("parseSource", () => {
  it("understands shorthand, urls, git, and local forms", () => {
    expect(parseSource("mattpocock/skills")).toMatchObject({ sourceType: "github", source: "mattpocock/skills", selector: { kind: "any" } });
    expect(parseSource("mattpocock/skills@code-review")).toMatchObject({ selector: { kind: "name", name: "code-review" } });
    expect(parseSource("vercel-labs/agent-skills/vercel-react-best-practices")).toMatchObject({
      source: "vercel-labs/agent-skills",
      selector: { kind: "path", path: "vercel-react-best-practices" },
    });
    expect(parseSource("https://github.com/o/r/tree/main/skills/x")).toMatchObject({
      sourceType: "github",
      source: "o/r",
      ref: "main",
      selector: { kind: "path", path: "skills/x" },
    });
    expect(parseSource("https://gitlab.com/o/r")).toMatchObject({ sourceType: "gitlab", url: "https://gitlab.com/o/r.git" });
    expect(parseSource("git@example.com:o/r.git")).toMatchObject({ sourceType: "git", url: "git@example.com:o/r.git" });
    expect(parseSource("https://example.com/o/r.git")).toMatchObject({ sourceType: "git" });
    expect(parseSource("./skills")).toMatchObject({ sourceType: "local" });
    expect(() => parseSource("nonsense")).toThrow(/Cannot understand/);
  });

  it("rebuilds a spec from a lock entry", () => {
    const spec = specFromLock({ source: "o/r", sourceType: "github", skillPath: "skills/x/SKILL.md", ref: "v1" });
    expect(spec).toMatchObject({ url: "https://github.com/o/r.git", ref: "v1", selector: { kind: "path", path: "skills/x" } });
  });
});

describe("discoverSkills and selectSkills", () => {
  it("finds nested skills and selects by name, dir, or path", () => {
    const repo = path.join(root, "repo");
    writeSkill(path.join(repo, "skills", "engineering"), "review");
    writeSkill(path.join(repo, "skills"), "design");
    writeSkill(path.join(repo, "node_modules", "pkg"), "ignored");
    const skills = discoverSkills(repo);
    expect(skills.map((s) => s.skillPath)).toEqual(["skills/design/SKILL.md", "skills/engineering/review/SKILL.md"]);
    expect(selectSkills(skills, { kind: "name", name: "review" })[0].name).toBe("review");
    expect(selectSkills(skills, { kind: "path", path: "skills/design" })[0].name).toBe("design");
    expect(selectSkills(skills, { kind: "path", path: "review" })[0].name).toBe("review");
    expect(() => selectSkills(skills, { kind: "name", name: "nope" })).toThrow(/no skill named/);
  });

  it("treats a root SKILL.md as a single skill", () => {
    const single = writeSkill(root, "solo");
    expect(discoverSkills(single)).toHaveLength(1);
    expect(discoverSkills(single)[0].skillPath).toBe("SKILL.md");
  });
});

describe("install, check, and update from a local source", () => {
  it("installs into the hub, records the lock, then detects upstream and local changes", async () => {
    const repo = path.join(root, "repo");
    writeSkill(path.join(repo, "skills"), "thing", "v1\n");

    const installed = await installFromSource({ hub, source: `${repo}@thing`, force: false });
    expect(installed).toEqual([{ skill: "thing", outcome: "installed", message: `installed from ${repo}` }]);
    const lock = readLockfile(lockfilePathForHub(hub));
    expect(lock.skills.thing).toMatchObject({ sourceType: "local", skillPath: "skills/thing/SKILL.md" });
    expect(lock.skills.thing.computedHash).toBe(hashSkillDir(path.join(hub, "thing")));

    const again = await installFromSource({ hub, source: `${repo}@thing`, force: false });
    expect(again[0].outcome).toBe("skipped");

    expect((await checkUpdates({ hub }))[0].state).toBe("up-to-date");

    fs.writeFileSync(path.join(repo, "skills", "thing", "SKILL.md"), "---\nname: thing\ndescription: Test thing\n---\nv2\n");
    expect((await checkUpdates({ hub }))[0].state).toBe("update-available");

    fs.appendFileSync(path.join(hub, "thing", "SKILL.md"), "local edit\n");
    expect((await checkUpdates({ hub }))[0].state).toBe("modified-and-update");

    const refused = await updateSkills({ hub, force: false });
    expect(refused[0].outcome).toBe("skipped");
    const forced = await updateSkills({ hub, force: true });
    expect(forced[0].outcome).toBe("updated");
    expect(fs.readFileSync(path.join(hub, "thing", "SKILL.md"), "utf8")).toContain("v2");
    expect((await checkUpdates({ hub }))[0].state).toBe("up-to-date");
  });

  it("reports untracked skills and skips them on update", async () => {
    writeSkill(hub, "manual");
    upsertLockEntry(lockfilePathForHub(hub), "other", { source: "o/r", sourceType: "github", skillPath: "x/SKILL.md", computedHash: "h" });
    const checks = await checkUpdates({ hub, skills: ["manual"] });
    expect(checks[0].state).toBe("untracked");
    const results = await updateSkills({ hub, skills: ["manual"], force: false });
    expect(results[0].outcome).toBe("skipped");
  });
});
