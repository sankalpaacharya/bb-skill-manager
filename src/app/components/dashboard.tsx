// Dashboard header: the skill count with one chip per agent, and a row of
// stat tiles. Everything is derived from the current scan.
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import type { Mutations } from "../hooks/use-mutations";
import { isDrifted } from "../lib/meta";
import type { Agent, Skill, Status } from "../lib/types";
import { AgentLogo, SkillLogo, skillHealth, type SkillHealth } from "./primitives";

// ---------------------------------------------------------------- model ----

interface Issue {
  skill: Skill;
  agent?: Agent;
  kind: "update" | "modified" | "broken" | "unmanaged";
  text: string;
  action?: { label: string; run: () => void };
}

export function summarize(status: Status, agents: Agent[], mutations: Mutations) {
  const hub = status.skills.filter((skill) => skill.inHub);
  const tracked = hub.filter((skill) => skill.lock !== undefined).length;
  const updates = hub.filter((skill) => skill.update?.state === "update-available" || skill.update?.state === "modified-and-update");

  const issues: Issue[] = [];
  for (const skill of updates) {
    const edited = skill.update?.state === "modified-and-update";
    issues.push({
      skill,
      kind: "update",
      text: edited ? "newer upstream, but edited locally" : "newer version available",
      action: edited ? undefined : { label: "Update", run: () => void mutations.update([skill.name]) },
    });
  }
  for (const skill of status.skills) {
    for (const agent of agents) {
      const state = skill.cells[agent.id]?.state ?? "missing";
      if (state === "broken") {
        issues.push({
          skill,
          agent,
          kind: "broken",
          text: `broken in ${agent.label}`,
          action: skill.inHub ? { label: "Repair", run: () => void mutations.sync([skill.name], [agent.id], "link", true) } : undefined,
        });
      } else if (state === "modified" || state === "external-link") {
        issues.push({ skill, agent, kind: "modified", text: `${agent.label}'s copy differs from the hub` });
      }
    }
    if (!skill.inHub) {
      const owner = agents.find((agent) => skill.cells[agent.id]?.state === "unmanaged");
      issues.push({
        skill,
        agent: owner,
        kind: "unmanaged",
        text: owner !== undefined ? `only in ${owner.label}, not in the hub` : "not in the hub",
        action: owner !== undefined ? { label: "Adopt", run: () => void mutations.adopt(skill.name, owner.id) } : undefined,
      });
    }
  }

  const missing = hub.reduce(
    (count, skill) => count + agents.filter((agent) => (skill.cells[agent.id]?.state ?? "missing") === "missing").length,
    0,
  );

  const coverage = agents.map((agent) => {
    const has = hub.filter((skill) => (skill.cells[agent.id]?.state ?? "missing") !== "missing").length;
    const viaHub = hub.filter((skill) => skill.cells[agent.id]?.state === "hub").length;
    const drift = status.skills.filter((skill) => isDrifted(skill.cells[agent.id]?.state ?? "missing")).length;
    return { agent, has, total: hub.length, viaHub, drift };
  });

  const health: Record<SkillHealth, number> = { synced: 0, drifted: 0, update: 0, unmanaged: 0, partial: 0, broken: 0 };
  for (const skill of status.skills) health[skillHealth(skill, agents).health]++;

  return { total: status.skills.length, hub: hub.length, tracked, updates: updates.length, updateSkills: updates, issues, missing, coverage, health };
}

type Summary = ReturnType<typeof summarize>;

// ------------------------------------------------------------- pieces ----

/** Top strip: the headline number and one chip per agent (icon + count). No card around it. */
function Headline({ summary, selected, onSelect }: { summary: Summary; selected: string | null; onSelect: (id: string | null) => void }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-x-8 gap-y-3">
      <div>
        <div className="text-4xl font-semibold leading-none tracking-tight tabular-nums">{summary.total}</div>
        <div className="mt-1.5 text-sm text-muted-foreground">
          skills · {summary.hub} in the hub · {summary.tracked} with a known source
        </div>
      </div>
      <ul className="flex flex-wrap items-center gap-1">
        {summary.coverage.map(({ agent, has }) => {
          const active = selected === agent.id;
          return (
            <li key={agent.id}>
              <button
                type="button"
                onClick={() => onSelect(active ? null : agent.id)}
                aria-pressed={active}
                disabled={!agent.active}
                title={agent.active ? `${agent.label}: ${has} skills` : `${agent.label}: not installed`}
                className={cn(
                  "inline-flex h-8 items-center gap-1.5 rounded-md px-2 text-sm tabular-nums transition-colors",
                  active ? "bg-state-active text-foreground" : "text-muted-foreground hover:bg-state-hover hover:text-foreground",
                  !agent.active && "opacity-40",
                )}
              >
                <AgentLogo agent={agent} className="size-4" />
                {agent.active ? has : "–"}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** A tile: label, big number, one-line note, and a segmented bar underneath. */
function Tile({ label, value, note, segments }: { label: string; value: ReactNode; note: string; segments: Array<{ value: number; tone: string; label: string }> }) {
  const total = segments.reduce((sum, segment) => sum + segment.value, 0);
  return (
    <div className="rounded-xl border border-border bg-card px-5 py-4">
      <div className="text-sm text-muted-foreground">{label}</div>
      <div className="mt-1 text-3xl font-semibold leading-none tracking-tight tabular-nums">{value}</div>
      <div className="mt-1.5 text-xs text-muted-foreground">{note}</div>
      <div className="mt-4 flex h-1.5 gap-[2px] overflow-hidden rounded-full">
        {total === 0 ? (
          <span className="h-full flex-1 bg-muted" />
        ) : (
          segments
            .filter((segment) => segment.value > 0)
            .map((segment) => (
              <span
                key={segment.label}
                title={`${segment.label}: ${segment.value}`}
                className="h-full rounded-full"
                style={{ flexGrow: segment.value, backgroundColor: segment.tone }}
              />
            ))
        )}
      </div>
    </div>
  );
}

// ----------------------------------------------------------------- root ----

export function Dashboard({
  status,
  agents,
  mutations,
  selectedAgent,
  onSelectAgent,
}: {
  status: Status;
  agents: Agent[];
  mutations: Mutations;
  selectedAgent: string | null;
  onSelectAgent: (agentId: string | null) => void;
}) {
  const summary = summarize(status, agents, mutations);
  const { health } = summary;
  const inSync = health.synced;
  const attention = summary.issues.length + summary.missing;

  return (
    <div className="space-y-4">
      <Headline summary={summary} selected={selectedAgent} onSelect={onSelectAgent} />

      <div className="grid gap-2 lg:grid-cols-4">
        <Tile
          label="In sync"
          value={inSync}
          note={`${summary.total === 0 ? 0 : Math.round((inSync / summary.total) * 100)}% of skills`}
          segments={[
            { value: health.synced, tone: "var(--success)", label: "In sync" },
            { value: health.partial, tone: "var(--attention)", label: "Missing somewhere" },
            { value: health.drifted, tone: "var(--warning)", label: "Drifted" },
            { value: health.update, tone: "var(--primary)", label: "Update available" },
            { value: health.unmanaged, tone: "var(--pr-merged)", label: "Not in hub" },
            { value: health.broken, tone: "var(--destructive)", label: "Broken" },
          ]}
        />
        <div className="min-w-0 rounded-xl border border-border bg-card px-5 py-4 lg:col-span-2">
          <div className="text-sm text-muted-foreground">Updates</div>
          <div className="mt-1 text-3xl font-semibold leading-none tracking-tight tabular-nums">{summary.updates}</div>
          <div className="mt-1.5 text-xs text-muted-foreground">
            {summary.tracked === 0 ? "record a source to enable checks" : summary.updates === 0 ? "nothing newer upstream" : "newer versions available"}
          </div>
          {summary.updateSkills.length > 0 ? (
            <ul aria-label="Skills with updates available" className="mt-3 flex flex-wrap gap-1.5">
              {summary.updateSkills.map((skill) => {
                const label = `${skill.name}${skill.lock?.source ? ` · ${skill.lock.source}` : ""}${skill.update?.state === "modified-and-update" ? " · edited locally" : ""}`;
                return (
                  <li key={skill.name} title={label}>
                    <SkillLogo skill={skill} className="size-7" />
                    <span className="sr-only">{label}</span>
                  </li>
                );
              })}
            </ul>
          ) : null}
        </div>
        <Tile
          label="Gaps"
          value={attention}
          note={attention === 0 ? "everything is where it should be" : `${summary.missing} missing link${summary.missing === 1 ? "" : "s"} · ${summary.issues.length} to decide`}
          segments={[
            { value: summary.missing, tone: "var(--attention)", label: "Missing in an agent" },
            { value: summary.issues.length, tone: "var(--warning)", label: "Needs a decision" },
          ]}
        />
      </div>

    </div>
  );
}
