// Fetch a source into a temporary checkout and find the skills inside it.
//
// Git-backed sources are shallow-cloned once per `Fetcher` instance, so
// checking twenty skills from the same repository clones it once. Local
// sources are read in place.
import { execFile } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { promisify } from "node:util";
import { hasSkillMd, readFrontmatter } from "./frontmatter";
import type { SourceSpec, SkillSelector } from "./source";

const execFileAsync = promisify(execFile);

const CLONE_TIMEOUT_MS = 120_000;
const MAX_SCAN_DEPTH = 6;
const SKIPPED_DIRS: ReadonlySet<string> = new Set([".git", "node_modules", ".github"]);

export interface DiscoveredSkill {
  /** Directory name, which the spec says must equal the frontmatter name. */
  dirName: string;
  /** Frontmatter `name`, falling back to the directory name. */
  name: string;
  description: string;
  /** Absolute directory in the checkout. */
  dir: string;
  /** Path of SKILL.md relative to the source root, for the lockfile. */
  skillPath: string;
}

export interface Checkout {
  root: string;
  /** Resolved commit for git sources; absent for local. */
  commit?: string;
}

/** Walk a checkout for skill directories. */
export function discoverSkills(root: string): DiscoveredSkill[] {
  const found: DiscoveredSkill[] = [];
  const walk = (dir: string, depth: number): void => {
    if (depth > MAX_SCAN_DEPTH) return;
    if (hasSkillMd(dir) && dir !== root) {
      const meta = readFrontmatter(dir);
      const dirName = path.basename(dir);
      found.push({
        dirName,
        name: meta.name ?? dirName,
        description: meta.description ?? "",
        dir,
        skillPath: `${path.relative(root, dir).split(path.sep).join("/")}/SKILL.md`,
      });
      return; // skills do not nest
    }
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (!entry.isDirectory() || SKIPPED_DIRS.has(entry.name)) continue;
      walk(path.join(dir, entry.name), depth + 1);
    }
  };
  if (hasSkillMd(root)) {
    // The source root itself is a single skill.
    const meta = readFrontmatter(root);
    const dirName = path.basename(root);
    return [{ dirName, name: meta.name ?? dirName, description: meta.description ?? "", dir: root, skillPath: "SKILL.md" }];
  }
  walk(root, 0);
  return found.sort((a, b) => a.skillPath.localeCompare(b.skillPath));
}

/** Pick the skills a selector refers to. Throws when it matches nothing. */
export function selectSkills(skills: DiscoveredSkill[], selector: SkillSelector): DiscoveredSkill[] {
  switch (selector.kind) {
    case "any":
      return skills;
    case "name": {
      const matches = skills.filter((skill) => skill.name === selector.name || skill.dirName === selector.name);
      if (matches.length === 0) throw new Error(`no skill named "${selector.name}" in the source`);
      return matches;
    }
    case "path": {
      const wanted = selector.path.replace(/\/?SKILL\.md$/, "");
      const exact = skills.filter((skill) => skill.skillPath === `${wanted}/SKILL.md`);
      if (exact.length > 0) return exact;
      // The skills.sh id form is `owner/repo/<skillId>` where skillId is the
      // directory name, wherever it sits in the repo.
      const byDir = skills.filter((skill) => skill.dirName === wanted || skill.name === wanted);
      if (byDir.length > 0) return byDir;
      throw new Error(`no skill at "${selector.path}" in the source`);
    }
  }
}

export class Fetcher {
  private readonly checkouts = new Map<string, Promise<Checkout>>();
  private readonly tempDirs: string[] = [];

  /** Return a checkout for the spec, cloning at most once per url+ref. */
  checkout(spec: SourceSpec): Promise<Checkout> {
    if (spec.sourceType === "local") {
      if (!fs.existsSync(spec.url)) return Promise.reject(new Error(`local source "${spec.url}" does not exist`));
      return Promise.resolve({ root: spec.url });
    }
    const key = `${spec.url}#${spec.ref ?? ""}`;
    let pending = this.checkouts.get(key);
    if (pending === undefined) {
      pending = this.clone(spec);
      this.checkouts.set(key, pending);
    }
    return pending;
  }

  private async clone(spec: SourceSpec): Promise<Checkout> {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "skill-manager-"));
    this.tempDirs.push(dir);
    const args = ["clone", "--quiet", "--depth", "1"];
    if (spec.ref !== undefined) args.push("--branch", spec.ref);
    args.push("--", spec.url, dir);
    try {
      await execFileAsync("git", args, {
        timeout: CLONE_TIMEOUT_MS,
        env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
      });
      const { stdout } = await execFileAsync("git", ["-C", dir, "rev-parse", "HEAD"]);
      return { root: dir, commit: stdout.trim() };
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      throw new Error(`git clone of ${spec.url} failed: ${message.split("\n")[0]}`);
    }
  }

  /** Delete every temporary checkout. Safe to call more than once. */
  dispose(): void {
    for (const dir of this.tempDirs.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
    this.checkouts.clear();
  }
}
