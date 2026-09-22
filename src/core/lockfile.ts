// `skills-lock.json`: where each hub skill came from.
//
// The format is the one the Vercel `skills` CLI writes beside `.agents/`, so
// a skill installed by either tool is understood by both. Unknown keys are
// preserved on round-trip.
import * as fs from "node:fs";
import * as path from "node:path";

export const LOCKFILE_NAME = "skills-lock.json";

export type SourceType = "github" | "git" | "gitlab" | "local";

export interface LockEntry {
  /** `owner/repo` for GitHub/GitLab, a URL for generic git, a path for local. */
  source: string;
  sourceType: SourceType;
  /** Path of SKILL.md inside the source, e.g. `skills/foo/SKILL.md`. */
  skillPath: string;
  /** Folder hash at install time; see hash.ts. */
  computedHash: string;
  /** Clone URL, set for generic git sources. */
  sourceUrl?: string;
  /** Branch, tag, or commit the skill was fetched from. */
  ref?: string;
  [extra: string]: unknown;
}

export interface Lockfile {
  version: 1;
  skills: Record<string, LockEntry>;
  [extra: string]: unknown;
}

/** The lockfile sits next to the `.agents` directory that holds the hub. */
export function lockfilePathForHub(hub: string): string {
  const agentsDir = path.dirname(hub);
  return path.join(path.dirname(agentsDir), LOCKFILE_NAME);
}

export function emptyLockfile(): Lockfile {
  return { version: 1, skills: {} };
}

function isEntry(value: unknown): value is LockEntry {
  if (typeof value !== "object" || value === null) return false;
  const entry = value as Record<string, unknown>;
  return (
    typeof entry.source === "string" &&
    typeof entry.sourceType === "string" &&
    typeof entry.skillPath === "string" &&
    typeof entry.computedHash === "string"
  );
}

export function parseLockfile(text: string): Lockfile {
  const parsed: unknown = JSON.parse(text);
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error(`${LOCKFILE_NAME} must be a JSON object`);
  }
  const raw = parsed as Record<string, unknown>;
  const skills: Record<string, LockEntry> = {};
  const rawSkills = typeof raw.skills === "object" && raw.skills !== null ? raw.skills : {};
  for (const [name, value] of Object.entries(rawSkills as Record<string, unknown>)) {
    if (isEntry(value)) skills[name] = value;
  }
  return { ...raw, version: 1, skills };
}

export function readLockfile(file: string): Lockfile {
  let text: string;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch {
    return emptyLockfile();
  }
  return parseLockfile(text);
}

export function writeLockfile(file: string, lock: Lockfile): void {
  const ordered: Lockfile = {
    ...lock,
    version: 1,
    skills: Object.fromEntries(
      Object.entries(lock.skills).sort(([a], [b]) => a.localeCompare(b)),
    ),
  };
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(ordered, null, 2)}\n`);
}

export function upsertLockEntry(file: string, name: string, entry: LockEntry): Lockfile {
  const lock = readLockfile(file);
  lock.skills[name] = entry;
  writeLockfile(file, lock);
  return lock;
}

export function removeLockEntry(file: string, name: string): boolean {
  const lock = readLockfile(file);
  if (!(name in lock.skills)) return false;
  delete lock.skills[name];
  writeLockfile(file, lock);
  return true;
}

/** Human label for a source, e.g. `mattpocock/skills`. */
export function describeSource(entry: Pick<LockEntry, "source" | "sourceType">): string {
  return entry.sourceType === "local" ? `local: ${entry.source}` : entry.source;
}
