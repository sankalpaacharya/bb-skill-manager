// Small filesystem and path helpers shared by the core modules.
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

/** Directory names never treated as skill content. */
export const IGNORED_DIRS: ReadonlySet<string> = new Set([
  ".git",
  "node_modules",
  "__pycache__",
  ".DS_Store",
]);

/** Expand a leading `~` and resolve to an absolute path. */
export function expandHome(input: string): string {
  const trimmed = input.trim();
  if (trimmed === "~") return os.homedir();
  if (trimmed.startsWith("~/")) return path.join(os.homedir(), trimmed.slice(2));
  return path.resolve(trimmed);
}

/** Replace the home directory prefix with `~` for display. */
export function contractHome(absolute: string): string {
  const home = os.homedir();
  if (absolute === home) return "~";
  return absolute.startsWith(home + path.sep) ? `~${absolute.slice(home.length)}` : absolute;
}

export function safeRealpath(target: string): string | null {
  try {
    return fs.realpathSync(target);
  } catch {
    return null;
  }
}

export function lstatOrNull(target: string): fs.Stats | null {
  try {
    return fs.lstatSync(target);
  } catch {
    return null;
  }
}

export function statOrNull(target: string): fs.Stats | null {
  try {
    return fs.statSync(target);
  } catch {
    return null;
  }
}

export function isDirectory(target: string): boolean {
  return statOrNull(target)?.isDirectory() ?? false;
}

export function isFile(target: string): boolean {
  return statOrNull(target)?.isFile() ?? false;
}

/** Delete a symlink, file, or directory tree; missing paths are a no-op. */
export function removePath(target: string): void {
  const stats = lstatOrNull(target);
  if (stats === null) return;
  if (stats.isSymbolicLink() || stats.isFile()) fs.unlinkSync(target);
  else fs.rmSync(target, { recursive: true, force: true });
}

/** Copy a tree, following symlinks and skipping ignored directories. */
export function copyTree(from: string, to: string): void {
  fs.cpSync(from, to, {
    recursive: true,
    dereference: true,
    filter: (source) => !IGNORED_DIRS.has(path.basename(source)),
  });
}

export function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}
