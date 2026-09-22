// Agent targets: which coding agents read skills from where, and how the
// user extends or disables that list through plugin settings.
import { expandHome, safeRealpath } from "./paths";

export interface AgentTarget {
  /** Short stable id used on the CLI, e.g. `claude`. */
  id: string;
  /** Human label, e.g. `Claude Code`. */
  label: string;
  /** Absolute skills directory (tilde already expanded). */
  dir: string;
  /** BB agent provider id whose logo represents this agent, when one exists. */
  providerId?: string;
  /**
   * The agent also reads the shared hub (~/.agents/skills) natively, so a hub
   * skill is available to it without a link in its own directory.
   */
  readsHub?: boolean;
}

/** The canonical skills directory; agents receive links or copies of it. */
export const DEFAULT_HUB = "~/.agents/skills";

export const DEFAULT_AGENTS: ReadonlyArray<AgentTarget> = [
  { id: "claude", label: "Claude Code", dir: "~/.claude/skills", providerId: "claude-code" },
  { id: "codex", label: "Codex", dir: "~/.codex/skills", providerId: "codex", readsHub: true },
  { id: "pi", label: "Pi", dir: "~/.pi/agent/skills", providerId: "pi", readsHub: true },
  { id: "opencode", label: "OpenCode", dir: "~/.config/opencode/skills", providerId: "acp-opencode" },
  { id: "gemini", label: "Gemini CLI", dir: "~/.gemini/skills" },
  { id: "cursor", label: "Cursor", dir: "~/.cursor/skills", providerId: "acp-cursor" },
  { id: "copilot", label: "Copilot CLI", dir: "~/.copilot/skills", readsHub: true },
];

const AGENT_ID = /^[a-z0-9][a-z0-9-]{0,31}$/;
const SKILL_NAME = /^[a-z0-9][a-z0-9._-]{0,127}$/i;

export function isValidSkillName(name: string): boolean {
  return SKILL_NAME.test(name) && name !== "." && name !== "..";
}

export function assertSkillName(name: string): string {
  if (!isValidSkillName(name)) {
    throw new Error(
      `Invalid skill name "${name}": use letters, digits, ".", "_" or "-" only.`,
    );
  }
  return name;
}

/**
 * Parse the `extraAgents` setting: a JSON array of `{ id, label?, dir, providerId?, readsHub? }`.
 * An entry whose id matches a default agent overrides that agent's directory.
 */
export function parseExtraAgents(json: string): AgentTarget[] {
  const raw = json.trim();
  if (raw === "" || raw === "[]") return [];
  const parsed: unknown = JSON.parse(raw);
  if (!Array.isArray(parsed)) throw new Error("extraAgents must be a JSON array");
  return parsed.map((item, index) => {
    if (typeof item !== "object" || item === null || Array.isArray(item)) {
      throw new Error(`extraAgents[${index}] must be an object`);
    }
    const { id, label, dir, providerId, readsHub } = item as Record<string, unknown>;
    if (typeof id !== "string" || !AGENT_ID.test(id)) {
      throw new Error(`extraAgents[${index}].id must match ${AGENT_ID}`);
    }
    if (typeof dir !== "string" || dir.trim() === "") {
      throw new Error(`extraAgents[${index}].dir is required`);
    }
    return {
      id,
      label: typeof label === "string" && label.trim() !== "" ? label.trim() : id,
      dir: expandHome(dir),
      // Omit rather than set undefined: agent records travel over strict-JSON RPC.
      ...(typeof providerId === "string" && providerId !== "" ? { providerId } : {}),
      ...(readsHub === true ? { readsHub: true } : {}),
    };
  });
}

/** Parse the comma-separated `disabledAgents` setting. */
export function parseDisabledAgents(value: string): string[] {
  return value
    .split(",")
    .map((id) => id.trim())
    .filter((id) => id !== "");
}

/** Merge defaults with user additions, drop disabled ids and the hub itself. */
export function resolveAgents(options: {
  hub: string;
  extraAgents?: AgentTarget[];
  disabled?: string[];
}): AgentTarget[] {
  const disabled = new Set(options.disabled ?? []);
  const byId = new Map<string, AgentTarget>();
  for (const agent of DEFAULT_AGENTS) {
    byId.set(agent.id, { ...agent, dir: expandHome(agent.dir) });
  }
  for (const agent of options.extraAgents ?? []) byId.set(agent.id, agent);
  const hubReal = safeRealpath(options.hub) ?? options.hub;
  return [...byId.values()].filter((agent) => {
    if (disabled.has(agent.id)) return false;
    const real = safeRealpath(agent.dir) ?? agent.dir;
    return real !== hubReal;
  });
}
