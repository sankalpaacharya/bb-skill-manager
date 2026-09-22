// Read a skill's files for display. Paths are confined to the skill folder
// and file size is capped so a stray binary cannot flood the page.
import * as fs from "node:fs";
import * as path from "node:path";
import { listSkillFiles } from "./hash";
import { safeRealpath } from "./paths";

export const MAX_FILE_BYTES = 512 * 1024;

export interface SkillFile {
  path: string;
  sizeBytes: number;
}

export function listFiles(skillDir: string): SkillFile[] {
  return listSkillFiles(skillDir).map((relative) => {
    let sizeBytes = 0;
    try {
      sizeBytes = fs.statSync(path.join(skillDir, relative)).size;
    } catch {
      // unreadable: report 0
    }
    return { path: relative, sizeBytes };
  });
}

export interface FileContent {
  path: string;
  content: string;
  /** True when the file was cut at MAX_FILE_BYTES. */
  truncated: boolean;
  binary: boolean;
}

export function readFile(skillDir: string, relative: string): FileContent {
  const root = safeRealpath(skillDir);
  if (root === null) throw new Error("skill directory does not exist");
  const target = safeRealpath(path.join(root, relative));
  if (target === null || (target !== root && !target.startsWith(root + path.sep))) {
    throw new Error(`"${relative}" is not inside the skill`);
  }
  const stats = fs.statSync(target);
  if (!stats.isFile()) throw new Error(`"${relative}" is not a file`);
  const handle = fs.openSync(target, "r");
  try {
    const length = Math.min(stats.size, MAX_FILE_BYTES);
    const buffer = Buffer.alloc(length);
    fs.readSync(handle, buffer, 0, length, 0);
    const binary = buffer.subarray(0, 4096).includes(0);
    return {
      path: relative,
      content: binary ? "" : buffer.toString("utf8"),
      truncated: stats.size > MAX_FILE_BYTES,
      binary,
    };
  } finally {
    fs.closeSync(handle);
  }
}
