// Content hash of a skill folder.
//
// Deliberately identical to the algorithm in the Vercel `skills` CLI
// (`computeSkillFolderHash`): sha256 over files sorted by relative path,
// feeding `relativePath` then the file bytes, skipping `.git` and
// `node_modules`. Matching it means our lockfile entries and theirs agree.
import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { statOrNull } from "./paths";

const SKIPPED_DIRS: ReadonlySet<string> = new Set([".git", "node_modules"]);

/** Sorted relative file paths under a skill directory; symlinked files are followed. */
export function listSkillFiles(root: string): string[] {
  const files: string[] = [];
  const walk = (dir: string, prefix: string): void => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const absolute = path.join(dir, entry.name);
      const relative = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
      const stats = entry.isSymbolicLink() ? statOrNull(absolute) : entry;
      if (stats === null) continue;
      if (stats.isDirectory()) {
        if (!SKIPPED_DIRS.has(entry.name)) walk(absolute, relative);
      } else if (stats.isFile()) {
        files.push(relative);
      }
    }
  };
  walk(root, "");
  return files.sort((a, b) => a.localeCompare(b));
}

/** Full sha256 hex digest of a skill directory. */
export function hashSkillDir(root: string): string {
  const hash = createHash("sha256");
  for (const relative of listSkillFiles(root)) {
    hash.update(relative);
    try {
      hash.update(fs.readFileSync(path.join(root, relative)));
    } catch {
      // An unreadable file still contributes its path, so the hash stays stable.
    }
  }
  return hash.digest("hex");
}

/** Short form for display. */
export function shortHash(hash: string): string {
  return hash.slice(0, 12);
}
