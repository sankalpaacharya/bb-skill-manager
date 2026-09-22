// Compare hub skills against their recorded source.
//
// Three hashes matter for each tracked skill:
//   lock      what we installed (lockfile `computedHash`)
//   hub       what is in the hub now
//   upstream  what the source has now
// hub != lock means local edits; upstream != lock means an update exists.
import * as path from "node:path";
import { Fetcher, discoverSkills, selectSkills } from "./fetch";
import { hashSkillDir } from "./hash";
import { lockfilePathForHub, readLockfile, upsertLockEntry, type LockEntry } from "./lockfile";
import { copyTree, errorMessage, removePath } from "./paths";
import { specFromLock } from "./source";

export type UpdateState =
  | "up-to-date"
  | "update-available"
  | "modified" // local edits, upstream unchanged
  | "modified-and-update" // local edits AND upstream changed
  | "untracked" // no lockfile entry
  | "error";

export interface UpdateCheck {
  skill: string;
  state: UpdateState;
  source?: string;
  lockHash?: string;
  hubHash?: string;
  upstreamHash?: string;
  checkedAt: number;
  message?: string;
}

/** Check one skill against its source using an already-open fetcher. */
export async function checkSkill(
  hub: string,
  name: string,
  entry: LockEntry | undefined,
  fetcher: Fetcher,
): Promise<UpdateCheck> {
  const checkedAt = Date.now();
  if (entry === undefined) return { skill: name, state: "untracked", checkedAt };
  const hubHash = hashSkillDir(path.join(hub, name));
  try {
    const spec = specFromLock(entry);
    const checkout = await fetcher.checkout(spec);
    const [upstream] = selectSkills(discoverSkills(checkout.root), spec.selector);
    const upstreamHash = hashSkillDir(upstream.dir);
    const modified = hubHash !== entry.computedHash;
    const changed = upstreamHash !== entry.computedHash;
    const state: UpdateState = modified
      ? changed
        ? "modified-and-update"
        : "modified"
      : changed
        ? "update-available"
        : "up-to-date";
    return {
      skill: name,
      state,
      source: entry.source,
      lockHash: entry.computedHash,
      hubHash,
      upstreamHash,
      checkedAt,
    };
  } catch (cause) {
    return {
      skill: name,
      state: "error",
      source: entry.source,
      lockHash: entry.computedHash,
      hubHash,
      checkedAt,
      message: errorMessage(cause),
    };
  }
}

/** Check every tracked skill (or the named ones). One clone per repository. */
export async function checkUpdates(options: { hub: string; skills?: string[] }): Promise<UpdateCheck[]> {
  const lock = readLockfile(lockfilePathForHub(options.hub));
  const names = options.skills ?? Object.keys(lock.skills).sort();
  const fetcher = new Fetcher();
  try {
    const results: UpdateCheck[] = [];
    for (const name of names) results.push(await checkSkill(options.hub, name, lock.skills[name], fetcher));
    return results;
  } finally {
    fetcher.dispose();
  }
}

export interface UpdateResult {
  skill: string;
  outcome: "updated" | "skipped" | "error";
  message: string;
}

/** Replace hub skills with their upstream version and refresh the lockfile. */
export async function updateSkills(options: {
  hub: string;
  skills?: string[];
  /** Overwrite locally modified skills. */
  force: boolean;
}): Promise<UpdateResult[]> {
  const lockFile = lockfilePathForHub(options.hub);
  const lock = readLockfile(lockFile);
  const names = options.skills ?? Object.keys(lock.skills).sort();
  const fetcher = new Fetcher();
  try {
    const results: UpdateResult[] = [];
    for (const name of names) {
      const entry = lock.skills[name];
      if (entry === undefined) {
        results.push({ skill: name, outcome: "skipped", message: "no source recorded; set one first" });
        continue;
      }
      const check = await checkSkill(options.hub, name, entry, fetcher);
      if (check.state === "error") {
        results.push({ skill: name, outcome: "error", message: check.message ?? "check failed" });
        continue;
      }
      if (check.state === "up-to-date" || check.state === "modified") {
        results.push({ skill: name, outcome: "skipped", message: check.state === "modified" ? "local edits, upstream unchanged" : "already up to date" });
        continue;
      }
      if (check.state === "modified-and-update" && !options.force) {
        results.push({ skill: name, outcome: "skipped", message: "local edits would be lost; pass --force" });
        continue;
      }
      try {
        const spec = specFromLock(entry);
        const checkout = await fetcher.checkout(spec);
        const [upstream] = selectSkills(discoverSkills(checkout.root), spec.selector);
        const destination = path.join(options.hub, name);
        removePath(destination);
        copyTree(upstream.dir, destination);
        upsertLockEntry(lockFile, name, { ...entry, computedHash: hashSkillDir(destination) });
        results.push({ skill: name, outcome: "updated", message: `updated from ${entry.source}` });
      } catch (cause) {
        results.push({ skill: name, outcome: "error", message: errorMessage(cause) });
      }
    }
    return results;
  } finally {
    fetcher.dispose();
  }
}
