// Read-only inspection: which skills exist where, and how each agent's copy
// relates to the hub copy.
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { isValidSkillName, type AgentTarget } from "./agents";
import { hasSkillMd, readFrontmatter } from "./frontmatter";
import { hashSkillDir } from "./hash";
import { lockfilePathForHub, readLockfile, type LockEntry } from "./lockfile";
import { isDirectory, lstatOrNull, safeRealpath } from "./paths";

export type CellState =
  | "missing" // the agent has no entry for this skill
  | "linked" // symlink that resolves to the hub copy
  | "same" // real directory, byte-identical to the hub copy
  | "modified" // real directory, differs from the hub copy
  | "unmanaged" // present in the agent, but the hub has no such skill
  | "external-link" // symlink to somewhere other than the hub
  | "broken" // dangling symlink, or a directory without SKILL.md
  | "hub"; // nothing in the agent dir, but the agent reads the hub natively

export interface Cell {
  state: CellState;
  /** Absolute path of the entry inside the agent's skills directory. */
  path: string;
  /** Resolved symlink target when the entry is a symlink. */
  target?: string;
  /** Content hash of the entry (or of the hub copy for `linked`). */
  hash?: string;
}

export interface SkillRow {
  name: string;
  description: string;
  inHub: boolean;
  hubPath?: string;
  hubHash?: string;
  /** Lockfile entry, when the hub skill's origin is recorded. */
  lock?: LockEntry;
  /** Keyed by agent id. */
  cells: Record<string, Cell>;
}

export interface AgentStatus extends AgentTarget {
  /** The agent's own skills directory exists. */
  exists: boolean;
  /** The agent can see skills: its own dir exists, or it reads the hub and the hub exists. */
  active: boolean;
}

export interface Status {
  hub: string;
  hubExists: boolean;
  /** Absolute path of the lockfile that records skill sources. */
  lockfile: string;
  agents: AgentStatus[];
  skills: SkillRow[];
}


/** Skill entry names directly under a directory; dot-entries are skipped. */
function listEntryNames(dir: string): string[] {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .filter((entry) => !entry.name.startsWith("."))
    .filter((entry) => entry.isDirectory() || entry.isSymbolicLink())
    .map((entry) => entry.name)
    .filter(isValidSkillName)
    .sort();
}

interface HubRef {
  inHub: boolean;
  real: string | null;
  hash?: string;
}

/** Classify one agent entry against the hub copy of the same skill. */
export function inspectEntry(entryPath: string, hub: HubRef): Cell {
  const stats = lstatOrNull(entryPath);
  if (stats === null) return { state: "missing", path: entryPath };

  if (stats.isSymbolicLink()) {
    let target: string;
    try {
      target = fs.readlinkSync(entryPath);
    } catch {
      target = "?";
    }
    const real = safeRealpath(entryPath);
    if (real === null || !hasSkillMd(real)) return { state: "broken", path: entryPath, target };
    if (hub.real !== null && real === hub.real) {
      return { state: "linked", path: entryPath, target: real, ...(hub.hash !== undefined ? { hash: hub.hash } : {}) };
    }
    const hash = hashSkillDir(real);
    const state: CellState = hub.inHub ? "external-link" : "unmanaged";
    return { state, path: entryPath, target: real, hash };
  }

  if (!stats.isDirectory() || !hasSkillMd(entryPath)) {
    return { state: "broken", path: entryPath };
  }
  const hash = hashSkillDir(entryPath);
  if (!hub.inHub) return { state: "unmanaged", path: entryPath, hash };
  return { state: hash === hub.hash ? "same" : "modified", path: entryPath, hash };
}

function firstDescription(row: Pick<SkillRow, "cells">): string {
  for (const cell of Object.values(row.cells)) {
    if (cell.state === "missing" || cell.state === "hub" || cell.state === "broken") continue;
    const description = readFrontmatter(cell.target ?? cell.path).description ?? "";
    if (description !== "") return description;
  }
  return "";
}

/** `~/.pi/agent/skills` -> `~/.pi`; the tool's config root, used to detect an install. */
function configRoot(dir: string): string {
  const home = os.homedir();
  if (dir.startsWith(`${home}${path.sep}`)) {
    const first = dir.slice(home.length + 1).split(path.sep)[0];
    return path.join(home, first);
  }
  return path.dirname(dir);
}

/** Build the full skill × agent matrix. */
export function scanStatus(options: { hub: string; agents: AgentTarget[] }): Status {
  const { hub } = options;
  const hubExists = isDirectory(hub);
  const lockfile = lockfilePathForHub(hub);
  const lock = readLockfile(lockfile);
  const agents: AgentStatus[] = options.agents.map((agent) => {
    const exists = isDirectory(agent.dir);
    // A hub-reading agent counts as present when the tool itself is installed
    // (its config root exists), even if it never created its own skills dir.
    const installed = exists || isDirectory(configRoot(agent.dir));
    return { ...agent, exists, active: exists || (agent.readsHub === true && hubExists && installed) };
  });

  const names = new Set<string>(hubExists ? listEntryNames(hub) : []);
  for (const agent of agents) {
    if (!agent.exists) continue;
    for (const name of listEntryNames(agent.dir)) names.add(name);
  }

  const skills: SkillRow[] = [];
  for (const name of [...names].sort()) {
    const hubPath = path.join(hub, name);
    const hubReal = hubExists ? safeRealpath(hubPath) : null;
    const inHub = hubReal !== null && hasSkillMd(hubReal);
    const hubHash = inHub ? hashSkillDir(hubReal) : undefined;
    const hubRef: HubRef = { inHub, real: hubReal, hash: hubHash };

    const cells: Record<string, Cell> = {};
    for (const agent of agents) {
      const entryPath = path.join(agent.dir, name);
      const cell: Cell = agent.exists ? inspectEntry(entryPath, hubRef) : { state: "missing", path: entryPath };
      // An agent that reads the hub natively sees every hub skill without a
      // link of its own; only an entry in its own dir overrides that.
      cells[agent.id] = cell.state === "missing" && inHub && agent.readsHub === true ? { state: "hub", path: entryPath } : cell;
    }

    const hubDescription = inHub ? (readFrontmatter(hubReal).description ?? "") : "";
    // RPC outputs must be strict JSON: omit optional keys instead of sending undefined.
    skills.push({
      name,
      description: hubDescription !== "" ? hubDescription : firstDescription({ cells }),
      inHub,
      ...(inHub ? { hubPath, hubHash } : {}),
      ...(inHub && lock.skills[name] !== undefined ? { lock: lock.skills[name] } : {}),
      cells,
    });
  }
  return { hub, hubExists, lockfile, agents, skills };
}
