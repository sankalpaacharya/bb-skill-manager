// Plain-text rendering for CLI output. JSON output bypasses this module.
import type { PluginCliResult } from "@get-bb/plugin-sdk";
import {
  contractHome,
  shortHash,
  type CellState,
  type DoctorIssue,
  type InstallResult,
  type OpResult,
  type SkillDiff,
  type UpdateCheck,
  type UpdateResult,
} from "../../core";
import type { StatusResponse } from "../contract";

export const USAGE = [
  "Usage:",
  "  bb skill-manager status [--json]                 Skill × agent matrix with sources",
  "  bb skill-manager agents [--json]                 Agent targets and their directories",
  "  bb skill-manager show <skill> [--json]           One skill: source, hub, and each agent",
  "  bb skill-manager diff <skill> <agent>            Compare an agent's copy with the hub",
  "  bb skill-manager sync <skill>|--all [--to a,b] [--copy|--link] [--force]",
  "  bb skill-manager remove <skill> --from <a,b> [--force]",
  "  bb skill-manager adopt <skill> --from <agent> [--force] [--link]",
  "",
  "  bb skill-manager install <source> [--to a,b|--all-agents] [--force]",
  "      source: owner/repo@skill · owner/repo/path · github URL · git URL · ./dir",
  "  bb skill-manager list-source <source>            Skills a source offers, without installing",
  "  bb skill-manager source <skill> <source>         Record where an existing hub skill came from",
  "  bb skill-manager resolve-sources [--force]       Match untracked skills on skills.sh; record confident ones",
  "  bb skill-manager check [skill...] [--json]       Compare hub skills with upstream",
  "  bb skill-manager update [skill...] [--force]     Fetch newer versions into the hub",
  "",
  "  bb skill-manager search [query] [--page n]       Search skills.sh (trending when empty)",
  "  bb skill-manager preview <registry-id>           Print a registry skill's SKILL.md",
  "  bb skill-manager cat <skill> [file] [--from a]   Print SKILL.md (or another file)",
  "  bb skill-manager files <skill> [--from a]        List a skill's files",
  "  bb skill-manager tag|untag <skill> <tag...>      Organize skills with tags",
  "  bb skill-manager tags [tag]                      List tags, or skills carrying one",
  "  bb skill-manager doctor [--json]                 Problems with a fix for each",
  "",
  "Cell states: link, same, MOD, only, ext, BROKEN, hub (reads the hub natively), -",
].join("\n");

const STATE_GLYPH: Record<CellState, string> = {
  missing: "-",
  linked: "link",
  same: "same",
  modified: "MOD",
  unmanaged: "only",
  "external-link": "ext",
  broken: "BROKEN",
  hub: "hub",
};

const UPDATE_GLYPH: Record<UpdateCheck["state"], string> = {
  "up-to-date": "ok",
  "update-available": "UPDATE",
  modified: "edited",
  "modified-and-update": "edited+UPDATE",
  untracked: "-",
  error: "error",
};

export function table(headers: string[], rows: string[][]): string {
  const widths = headers.map((header, column) => Math.max(header.length, ...rows.map((row) => row[column]?.length ?? 0)));
  const line = (cells: string[]) => cells.map((cell, column) => (cell ?? "").padEnd(widths[column])).join("  ").trimEnd();
  return [line(headers), ...rows.map(line)].join("\n");
}

export function ok(json: boolean, value: unknown, text: string, exitCode = 0): PluginCliResult {
  return { exitCode, stdout: json ? JSON.stringify(value, null, 2) : text };
}

export function fail(message: string): PluginCliResult {
  return { exitCode: 1, stderr: message };
}

export function renderStatus(status: StatusResponse): string {
  const agents = status.agents.filter((agent) => agent.active);
  const header = ["skill", "tags", "source", "upd", ...agents.map((agent) => agent.id)];
  const rows = status.skills.map((row) => [
    row.name,
    row.tags.join(","),
    row.inHub ? (row.lock?.source ?? "?") : "(not in hub)",
    row.update !== undefined ? UPDATE_GLYPH[row.update.state] : "",
    ...agents.map((agent) => STATE_GLYPH[row.cells[agent.id]?.state ?? "missing"]),
  ]);
  const hidden = status.agents.filter((agent) => !agent.active).map((agent) => agent.id);
  return [
    `hub: ${contractHome(status.hub)}${status.hubExists ? "" : " (missing)"}   lockfile: ${contractHome(status.lockfile)}   default mode: ${status.defaultMode}`,
    hidden.length > 0 ? `agents without a skills dir (hidden): ${hidden.join(", ")}` : "",
    "",
    rows.length === 0 ? "No skills found." : table(header, rows),
    "",
    "source ? = origin unknown; record one with: bb skill-manager source <skill> <owner/repo/path>",
  ]
    .filter((part) => part !== "")
    .join("\n");
}

export function renderOpResults(results: Array<OpResult & { skill?: string }>): string {
  return results
    .map((result) => {
      const where = result.skill === undefined ? result.agent : `${result.skill} → ${result.agent}`;
      return `${result.outcome.padEnd(7)} ${where}: ${result.message}`;
    })
    .join("\n");
}

export function renderInstallResults(results: InstallResult[]): string {
  return results.map((result) => `${result.outcome.padEnd(9)} ${result.skill}: ${result.message}`).join("\n");
}

export function renderUpdateResults(results: UpdateResult[]): string {
  return results.map((result) => `${result.outcome.padEnd(7)} ${result.skill}: ${result.message}`).join("\n");
}

export function renderChecks(checks: UpdateCheck[]): string {
  if (checks.length === 0) return "No tracked skills. Install one, or record a source with `bb skill-manager source`.";
  const rows = checks.map((check) => [
    check.skill,
    UPDATE_GLYPH[check.state],
    check.source ?? "",
    check.upstreamHash !== undefined ? shortHash(check.upstreamHash) : "",
    check.message ?? "",
  ]);
  return table(["skill", "state", "source", "upstream", "note"], rows);
}

export function renderDiff(diff: SkillDiff, skill: string, agent: string): string {
  if (diff.files.length === 0) return `No differences between the hub and ${agent} for "${skill}".`;
  const body = diff.files
    .map((file) => {
      const head = `${file.status.padEnd(7)} ${file.path}`;
      return file.diff === undefined ? head : `${head}\n${file.diff}`;
    })
    .join("\n\n");
  return `hub:   ${contractHome(diff.hubPath)}\nagent: ${contractHome(diff.agentPath)}\n\n${body}`;
}

export function renderDoctor(issues: DoctorIssue[]): string {
  if (issues.length === 0) return "No problems found.";
  const body = issues
    .map((issue) => `${issue.kind.padEnd(13)} ${issue.skill} @ ${issue.agent}: ${issue.detail}\n              fix: ${issue.fix}`)
    .join("\n");
  return `${issues.length} issue(s)\n\n${body}`;
}

export function exitCodeFor(results: Array<{ outcome: string }>): number {
  return results.some((result) => result.outcome === "error") ? 1 : 0;
}
