// Mutations: install a hub skill into agents, remove it, or adopt an agent's
// copy into the hub. Every operation returns per-agent results and never
// throws for a predictable refusal; only invalid input throws.
import * as fs from "node:fs";
import * as path from "node:path";
import { assertSkillName } from "./agents";
import { contractHome, copyTree, errorMessage, removePath, safeRealpath } from "./paths";
import { inspectEntry, type Status } from "./scan";

export type SyncMode = "link" | "copy";

export interface OpResult {
  agent: string;
  outcome: "done" | "skipped" | "error";
  message: string;
}

/** Install one hub skill into the given agents by symlink or copy. */
export function syncSkill(options: {
  status: Status;
  skill: string;
  agentIds: string[];
  mode: SyncMode;
  force: boolean;
}): OpResult[] {
  const { status, mode, force } = options;
  const name = assertSkillName(options.skill);
  const row = status.skills.find((skill) => skill.name === name);

  if (row === undefined || !row.inHub || row.hubPath === undefined) {
    const message = `"${name}" is not in the hub (${contractHome(status.hub)}); adopt it first`;
    return options.agentIds.map((agent) => ({ agent, outcome: "error", message }));
  }
  const hubReal = safeRealpath(row.hubPath) ?? row.hubPath;

  return options.agentIds.map((agentId): OpResult => {
    const agent = status.agents.find((candidate) => candidate.id === agentId);
    if (agent === undefined) return { agent: agentId, outcome: "error", message: "unknown agent" };

    const cell =
      row.cells[agentId] ??
      inspectEntry(path.join(agent.dir, name), { inHub: true, real: hubReal, hash: row.hubHash });

    if (cell.state === "hub" && !force) {
      return { agent: agentId, outcome: "skipped", message: `${agent.label} already reads the hub; pass --force to add a link anyway` };
    }
    if (cell.state === "linked" && mode === "link") {
      return { agent: agentId, outcome: "skipped", message: "already linked" };
    }
    if (cell.state === "same" && mode === "copy") {
      return { agent: agentId, outcome: "skipped", message: "already identical" };
    }
    if ((cell.state === "modified" || cell.state === "external-link") && !force) {
      return {
        agent: agentId,
        outcome: "skipped",
        message: `${cell.state} copy in ${agent.label}; pass --force to overwrite, or adopt it first`,
      };
    }
    try {
      fs.mkdirSync(agent.dir, { recursive: true });
      removePath(cell.path);
      if (mode === "link") fs.symlinkSync(hubReal, cell.path, "dir");
      else copyTree(hubReal, cell.path);
      return {
        agent: agentId,
        outcome: "done",
        message: mode === "link" ? `linked to ${contractHome(hubReal)}` : "copied from hub",
      };
    } catch (cause) {
      return { agent: agentId, outcome: "error", message: errorMessage(cause) };
    }
  });
}

/** Remove a skill entry from the given agents. */
export function removeSkill(options: {
  status: Status;
  skill: string;
  agentIds: string[];
  force: boolean;
}): OpResult[] {
  const { status, force } = options;
  const name = assertSkillName(options.skill);
  const row = status.skills.find((skill) => skill.name === name);

  return options.agentIds.map((agentId): OpResult => {
    const agent = status.agents.find((candidate) => candidate.id === agentId);
    if (agent === undefined) return { agent: agentId, outcome: "error", message: "unknown agent" };

    const cell = row?.cells[agentId];
    if (cell === undefined || cell.state === "missing" || cell.state === "hub") {
      return { agent: agentId, outcome: "skipped", message: cell?.state === "hub" ? "seen via the hub; remove it from the hub instead" : "not present" };
    }
    const wouldLoseContent = cell.state === "modified" || cell.state === "unmanaged";
    if (wouldLoseContent && !force) {
      return {
        agent: agentId,
        outcome: "skipped",
        message: `${cell.state} content would be lost; adopt it first or pass --force`,
      };
    }
    try {
      removePath(cell.path);
      return { agent: agentId, outcome: "done", message: "removed" };
    } catch (cause) {
      return { agent: agentId, outcome: "error", message: errorMessage(cause) };
    }
  });
}

/** Copy an agent's version of a skill into the hub, making it canonical. */
export function adoptSkill(options: {
  status: Status;
  skill: string;
  fromAgent: string;
  force: boolean;
}): OpResult {
  const { status, force, fromAgent } = options;
  const name = assertSkillName(options.skill);
  const agent = status.agents.find((candidate) => candidate.id === fromAgent);
  if (agent === undefined) return { agent: fromAgent, outcome: "error", message: "unknown agent" };

  const row = status.skills.find((skill) => skill.name === name);
  const cell = row?.cells[fromAgent];
  if (cell === undefined || cell.state === "missing" || cell.state === "hub" || cell.state === "broken") {
    return { agent: agent.id, outcome: "error", message: `${agent.label} has no copy of "${name}" of its own` };
  }
  if (cell.state === "linked") {
    return { agent: agent.id, outcome: "skipped", message: "already a link to the hub" };
  }
  if (row?.inHub && !force) {
    const message =
      cell.state === "same"
        ? "hub already has identical content"
        : "hub already has this skill; pass --force to overwrite the hub copy";
    return { agent: agent.id, outcome: "skipped", message };
  }

  const source = cell.target ?? cell.path;
  const destination = path.join(status.hub, name);
  try {
    fs.mkdirSync(status.hub, { recursive: true });
    removePath(destination);
    copyTree(source, destination);
    return { agent: agent.id, outcome: "done", message: `adopted into ${contractHome(destination)}` };
  } catch (cause) {
    return { agent: agent.id, outcome: "error", message: errorMessage(cause) };
  }
}
