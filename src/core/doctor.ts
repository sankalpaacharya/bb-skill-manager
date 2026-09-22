// Turn a status matrix into a list of actionable problems.
import { contractHome } from "./paths";
import type { Status } from "./scan";

export type IssueKind = "broken" | "modified" | "external-link" | "unmanaged";

export interface DoctorIssue {
  skill: string;
  agent: string;
  kind: IssueKind;
  detail: string;
  /** A ready-to-run command that resolves the issue. */
  fix: string;
}

export function doctor(status: Status): DoctorIssue[] {
  const issues: DoctorIssue[] = [];
  for (const row of status.skills) {
    for (const [agentId, cell] of Object.entries(row.cells)) {
      const label = status.agents.find((agent) => agent.id === agentId)?.label ?? agentId;
      const base = { skill: row.name, agent: agentId };
      switch (cell.state) {
        case "broken":
          issues.push({
            ...base,
            kind: "broken",
            detail:
              cell.target !== undefined
                ? `dangling symlink to ${cell.target}`
                : "directory has no SKILL.md",
            fix: row.inHub
              ? `bb skill-manager sync ${row.name} --to ${agentId} --force`
              : `bb skill-manager remove ${row.name} --from ${agentId} --force`,
          });
          break;
        case "modified":
          issues.push({
            ...base,
            kind: "modified",
            detail: `${label} copy differs from the hub`,
            fix: `bb skill-manager diff ${row.name} ${agentId}`,
          });
          break;
        case "external-link":
          issues.push({
            ...base,
            kind: "external-link",
            detail: `symlink to ${contractHome(cell.target ?? "?")} instead of the hub`,
            fix: `bb skill-manager sync ${row.name} --to ${agentId} --force`,
          });
          break;
        case "unmanaged":
          issues.push({
            ...base,
            kind: "unmanaged",
            detail: `only in ${label}; not in the hub`,
            fix: `bb skill-manager adopt ${row.name} --from ${agentId}`,
          });
          break;
        default:
          break;
      }
    }
  }
  return issues;
}
