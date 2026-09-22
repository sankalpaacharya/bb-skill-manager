import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  adoptSkill,
  diffSkill,
  doctor,
  lineDiff,
  parseExtraAgents,
  removeSkill,
  resolveAgents,
  scanStatus,
  syncSkill,
  type AgentTarget,
} from "./index";

let root: string;
let hub: string;
let agents: AgentTarget[];

function writeSkill(dir: string, name: string, body = "# body\n", extra: Record<string, string> = {}) {
  const skillDir = path.join(dir, name);
  fs.mkdirSync(skillDir, { recursive: true });
  fs.writeFileSync(
    path.join(skillDir, "SKILL.md"),
    `---\nname: ${name}\ndescription: Test ${name}\n---\n${body}`,
  );
  for (const [file, content] of Object.entries(extra)) {
    fs.mkdirSync(path.dirname(path.join(skillDir, file)), { recursive: true });
    fs.writeFileSync(path.join(skillDir, file), content);
  }
  return skillDir;
}

function scan() {
  return scanStatus({ hub, agents });
}

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "skill-manager-"));
  hub = path.join(root, "home", ".agents", "skills");
  agents = [
    { id: "a", label: "Agent A", dir: path.join(root, "a") },
    { id: "b", label: "Agent B", dir: path.join(root, "b") },
  ];
  fs.mkdirSync(hub, { recursive: true });
  fs.mkdirSync(agents[0].dir);
  // agent b has no skills directory yet
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

describe("scanStatus", () => {
  it("classifies every cell state", () => {
    writeSkill(hub, "linked");
    writeSkill(hub, "same");
    writeSkill(hub, "modified");
    writeSkill(hub, "ext");
    writeSkill(hub, "broken");
    fs.symlinkSync(path.join(hub, "linked"), path.join(agents[0].dir, "linked"));
    writeSkill(agents[0].dir, "same");
    writeSkill(agents[0].dir, "modified", "# changed\n");
    const elsewhere = writeSkill(path.join(root, "elsewhere"), "ext");
    fs.symlinkSync(elsewhere, path.join(agents[0].dir, "ext"));
    fs.symlinkSync(path.join(root, "nope"), path.join(agents[0].dir, "broken"));
    writeSkill(agents[0].dir, "only");

    const status = scan();
    const state = (name: string) => status.skills.find((s) => s.name === name)?.cells.a.state;
    expect(state("linked")).toBe("linked");
    expect(state("same")).toBe("same");
    expect(state("modified")).toBe("modified");
    expect(state("ext")).toBe("external-link");
    expect(state("broken")).toBe("broken");
    expect(state("only")).toBe("unmanaged");
    expect(status.skills.find((s) => s.name === "linked")?.cells.b.state).toBe("missing");
    expect(status.agents.find((a) => a.id === "b")?.exists).toBe(false);
  });

  it("reads the description from the hub, falling back to an agent copy", () => {
    writeSkill(hub, "one");
    writeSkill(agents[0].dir, "two");
    const status = scan();
    expect(status.skills.map((s) => [s.name, s.description])).toEqual([
      ["one", "Test one"],
      ["two", "Test two"],
    ]);
  });

  it("never emits undefined values (RPC outputs must be strict JSON)", () => {
    writeSkill(hub, "managed");
    writeSkill(agents[0].dir, "only");
    fs.symlinkSync(path.join(hub, "managed"), path.join(agents[0].dir, "managed"));
    const status = scan();
    const walk = (value: unknown, trail: string): void => {
      if (value === undefined) throw new Error(`undefined at ${trail}`);
      if (typeof value !== "object" || value === null) return;
      for (const [key, child] of Object.entries(value)) walk(child, `${trail}.${key}`);
    };
    walk(status, "$");
  });

  it("hashes nested files and ignores node_modules", () => {
    writeSkill(hub, "deep", "# x\n", { "scripts/run.sh": "echo hi\n" });
    writeSkill(agents[0].dir, "deep", "# x\n", {
      "scripts/run.sh": "echo hi\n",
      "node_modules/pkg/index.js": "ignored",
    });
    expect(scan().skills[0].cells.a.state).toBe("same");
  });
});

describe("agents that read the hub natively", () => {
  it("report hub skills as seen via the hub and are active without their own dir", () => {
    writeSkill(hub, "shared");
    writeSkill(agents[0].dir, "shared");
    const codex: AgentTarget = { id: "codex", label: "Codex", dir: path.join(root, "codex"), readsHub: true };
    const status = scanStatus({ hub, agents: [...agents, codex] });
    const row = status.skills[0];
    expect(status.agents.find((a) => a.id === "codex")).toMatchObject({ exists: false, active: true });
    expect(row.cells.codex.state).toBe("hub");
    expect(row.cells.a.state).toBe("same");
    // A hub-reading agent whose own dir holds a copy reports that copy, not "hub".
    fs.mkdirSync(codex.dir);
    writeSkill(codex.dir, "shared", "# edited\n");
    expect(scanStatus({ hub, agents: [codex] }).skills[0].cells.codex.state).toBe("modified");
    // Syncing into a hub-reading agent is a no-op unless forced.
    fs.rmSync(path.join(codex.dir, "shared"), { recursive: true });
    const results = syncSkill({ status: scanStatus({ hub, agents: [codex] }), skill: "shared", agentIds: ["codex"], mode: "link", force: false });
    expect(results[0].outcome).toBe("skipped");
  });
});

describe("syncSkill", () => {
  it("links into every agent and creates missing directories", () => {
    writeSkill(hub, "s");
    const results = syncSkill({ status: scan(), skill: "s", agentIds: ["a", "b"], mode: "link", force: false });
    expect(results.map((r) => r.outcome)).toEqual(["done", "done"]);
    expect(fs.lstatSync(path.join(agents[1].dir, "s")).isSymbolicLink()).toBe(true);
    expect(scan().skills[0].cells.b.state).toBe("linked");
  });

  it("copies when asked and reports already-identical", () => {
    writeSkill(hub, "s");
    syncSkill({ status: scan(), skill: "s", agentIds: ["a"], mode: "copy", force: false });
    expect(fs.lstatSync(path.join(agents[0].dir, "s")).isDirectory()).toBe(true);
    const again = syncSkill({ status: scan(), skill: "s", agentIds: ["a"], mode: "copy", force: false });
    expect(again[0]).toMatchObject({ outcome: "skipped", message: "already identical" });
  });

  it("refuses to overwrite a modified copy without force", () => {
    writeSkill(hub, "s");
    writeSkill(agents[0].dir, "s", "# local edits\n");
    const refused = syncSkill({ status: scan(), skill: "s", agentIds: ["a"], mode: "link", force: false });
    expect(refused[0].outcome).toBe("skipped");
    const forced = syncSkill({ status: scan(), skill: "s", agentIds: ["a"], mode: "link", force: true });
    expect(forced[0].outcome).toBe("done");
    expect(scan().skills[0].cells.a.state).toBe("linked");
  });

  it("errors for a skill that is not in the hub", () => {
    writeSkill(agents[0].dir, "only");
    const results = syncSkill({ status: scan(), skill: "only", agentIds: ["b"], mode: "link", force: false });
    expect(results[0].outcome).toBe("error");
  });

  it("rejects invalid skill names", () => {
    expect(() =>
      syncSkill({ status: scan(), skill: "../etc", agentIds: ["a"], mode: "link", force: false }),
    ).toThrow(/Invalid skill name/);
  });
});

describe("removeSkill", () => {
  it("removes links freely but guards modified content", () => {
    writeSkill(hub, "s");
    syncSkill({ status: scan(), skill: "s", agentIds: ["a"], mode: "link", force: false });
    expect(removeSkill({ status: scan(), skill: "s", agentIds: ["a"], force: false })[0].outcome).toBe("done");
    expect(fs.existsSync(path.join(hub, "s", "SKILL.md"))).toBe(true); // hub untouched

    writeSkill(agents[0].dir, "s", "# edited\n");
    expect(removeSkill({ status: scan(), skill: "s", agentIds: ["a"], force: false })[0].outcome).toBe("skipped");
    expect(removeSkill({ status: scan(), skill: "s", agentIds: ["a"], force: true })[0].outcome).toBe("done");
  });
});

describe("adoptSkill", () => {
  it("copies an unmanaged skill into the hub", () => {
    writeSkill(agents[0].dir, "mine", "# mine\n", { "ref/a.md": "a" });
    const result = adoptSkill({ status: scan(), skill: "mine", fromAgent: "a", force: false });
    expect(result.outcome).toBe("done");
    expect(fs.readFileSync(path.join(hub, "mine", "ref", "a.md"), "utf8")).toBe("a");
    expect(scan().skills[0].cells.a.state).toBe("same");
  });

  it("does not overwrite the hub without force", () => {
    writeSkill(hub, "s");
    writeSkill(agents[0].dir, "s", "# newer\n");
    expect(adoptSkill({ status: scan(), skill: "s", fromAgent: "a", force: false }).outcome).toBe("skipped");
    expect(adoptSkill({ status: scan(), skill: "s", fromAgent: "a", force: true }).outcome).toBe("done");
    expect(fs.readFileSync(path.join(hub, "s", "SKILL.md"), "utf8")).toContain("# newer");
  });
});

describe("diffSkill and lineDiff", () => {
  it("lists added, removed, and changed files with a line diff", () => {
    writeSkill(hub, "s", "line1\nline2\nline3\n", { "gone.md": "x" });
    writeSkill(agents[0].dir, "s", "line1\nchanged\nline3\n", { "new.md": "y" });
    const result = diffSkill({ status: scan(), skill: "s", agent: "a" });
    expect(result.files.map((f) => [f.path, f.status])).toEqual([
      ["SKILL.md", "changed"],
      ["gone.md", "removed"],
      ["new.md", "added"],
    ]);
    expect(result.files[0].diff).toContain("- line2");
    expect(result.files[0].diff).toContain("+ changed");
  });

  it("elides unchanged runs", () => {
    const a = Array.from({ length: 30 }, (_, i) => `l${i}`).join("\n");
    const b = a.replace("l5", "L5").replace("l25", "L25");
    const out = lineDiff(a, b);
    expect(out).toContain("@@");
    expect(out).not.toContain("l15");
    expect(out.split("\n").length).toBeLessThan(16);
  });
});

describe("doctor", () => {
  it("reports one issue per problem cell with a fix", () => {
    writeSkill(hub, "s");
    writeSkill(agents[0].dir, "s", "# edited\n");
    writeSkill(agents[0].dir, "only");
    const issues = doctor(scan());
    expect(issues.map((i) => [i.skill, i.kind])).toEqual([
      ["only", "unmanaged"],
      ["s", "modified"],
    ]);
    expect(issues.every((i) => i.fix.startsWith("bb skill-manager "))).toBe(true);
  });
});

describe("agent configuration", () => {
  it("parses extra agents and drops disabled ones and the hub", () => {
    const extra = parseExtraAgents('[{"id":"zed","label":"Zed","dir":"/tmp/zed/skills"}]');
    expect(extra).toEqual([{ id: "zed", label: "Zed", dir: "/tmp/zed/skills" }]);
    const resolved = resolveAgents({
      hub: "/tmp/zed/skills",
      extraAgents: extra,
      disabled: ["cursor", "copilot"],
    });
    const ids = resolved.map((a) => a.id);
    expect(ids).not.toContain("zed"); // same dir as the hub
    expect(ids).not.toContain("cursor");
    expect(ids).toContain("claude");
  });

  it("rejects malformed extra agents", () => {
    expect(() => parseExtraAgents("{}")).toThrow();
    expect(() => parseExtraAgents('[{"id":"Bad Id","dir":"/x"}]')).toThrow();
    expect(() => parseExtraAgents('[{"id":"ok"}]')).toThrow();
  });
});
