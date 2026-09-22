// Install skills from a source into the hub and record them in the lockfile.
import * as fs from "node:fs";
import * as path from "node:path";
import { isValidSkillName } from "./agents";
import { Fetcher, discoverSkills, selectSkills, type DiscoveredSkill } from "./fetch";
import { hashSkillDir } from "./hash";
import { lockfilePathForHub, readLockfile, upsertLockEntry, type LockEntry } from "./lockfile";
import { copyTree, errorMessage, removePath } from "./paths";
import { parseSource, type SourceSpec } from "./source";

export interface InstallResult {
  skill: string;
  outcome: "installed" | "updated" | "skipped" | "error";
  message: string;
}

export interface InstallOptions {
  hub: string;
  /** Anything `parseSource` accepts. */
  source: string;
  /** Overwrite a hub skill that already exists. */
  force: boolean;
  fetcher?: Fetcher;
}

/** Build the lockfile entry for a fetched skill. */
export function lockEntryFor(spec: SourceSpec, skill: DiscoveredSkill, hubDir: string): LockEntry {
  return {
    source: spec.source,
    sourceType: spec.sourceType,
    skillPath: skill.skillPath,
    computedHash: hashSkillDir(hubDir),
    ...(spec.sourceType === "git" ? { sourceUrl: spec.url } : {}),
    ...(spec.ref !== undefined ? { ref: spec.ref } : {}),
  };
}

/**
 * Install every skill the source selects. A source that names no particular
 * skill installs all of them; use `listSource` first to let the user choose.
 */
export async function installFromSource(options: InstallOptions): Promise<InstallResult[]> {
  const spec = parseSource(options.source);
  const fetcher = options.fetcher ?? new Fetcher();
  const ownFetcher = options.fetcher === undefined;
  try {
    const checkout = await fetcher.checkout(spec);
    const skills = selectSkills(discoverSkills(checkout.root), spec.selector);
    if (skills.length === 0) return [{ skill: "-", outcome: "error", message: "the source contains no SKILL.md" }];
    const lockFile = lockfilePathForHub(options.hub);
    const existing = readLockfile(lockFile).skills;
    return skills.map((skill) => installOne(spec, skill, options.hub, lockFile, existing[skill.name], options.force));
  } finally {
    if (ownFetcher) fetcher.dispose();
  }
}

function installOne(
  spec: SourceSpec,
  skill: DiscoveredSkill,
  hub: string,
  lockFile: string,
  previous: LockEntry | undefined,
  force: boolean,
): InstallResult {
  const name = skill.name;
  if (!isValidSkillName(name)) {
    return { skill: name, outcome: "error", message: "invalid skill name in frontmatter" };
  }
  const destination = path.join(hub, name);
  const exists = fs.existsSync(destination);
  if (exists && !force) {
    const sameSource = previous !== undefined && previous.source === spec.source && previous.skillPath === skill.skillPath;
    if (sameSource && previous.computedHash === hashSkillDir(skill.dir)) {
      return { skill: name, outcome: "skipped", message: "already installed and up to date" };
    }
    return {
      skill: name,
      outcome: "skipped",
      message: sameSource
        ? "already installed; run update to fetch the new version"
        : "a skill with this name is already in the hub; pass --force to replace it",
    };
  }
  try {
    fs.mkdirSync(hub, { recursive: true });
    removePath(destination);
    copyTree(skill.dir, destination);
    upsertLockEntry(lockFile, name, lockEntryFor(spec, skill, destination));
    return {
      skill: name,
      outcome: exists ? "updated" : "installed",
      message: `${exists ? "replaced" : "installed"} from ${spec.source}`,
    };
  } catch (cause) {
    return { skill: name, outcome: "error", message: errorMessage(cause) };
  }
}

/** List the skills a source offers without installing anything. */
export async function listSource(source: string, fetcher?: Fetcher): Promise<DiscoveredSkill[]> {
  const spec = parseSource(source);
  const own = fetcher ?? new Fetcher();
  try {
    const checkout = await own.checkout(spec);
    return selectSkills(discoverSkills(checkout.root), spec.selector).map((skill) => ({
      ...skill,
      dir: "", // the checkout is disposed; never hand out a dangling path
    }));
  } finally {
    if (fetcher === undefined) own.dispose();
  }
}
