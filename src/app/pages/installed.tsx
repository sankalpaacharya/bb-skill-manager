// The Installed tab: a dashboard header, search, and the skills as a card
// grid or a list. Selecting an agent shows that agent's view: its skills first, then
// hub skills it could add, each card describing only that agent.
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { Input } from "@/components/ui/input";
import { Dashboard } from "../components/dashboard";
import { cn } from "@/lib/utils";
import { Empty, OwnerAvatar } from "../components/primitives";
import { SkillCard, SkillCardDetail } from "../components/skill-card";
import { SkillRow } from "../components/skill-row";
import { TagFilter, UNTAGGED } from "../components/tags";
import type { Mutations } from "../hooks/use-mutations";
import type { Agent, Rpc, Skill, Status } from "../lib/types";

type View = "grid" | "list" | "groups";

const VIEWS: Array<{ key: View; icon: string; label: string }> = [
  { key: "grid", icon: "GridView", label: "Cards" },
  { key: "list", icon: "ListView", label: "List" },
  { key: "groups", icon: "Layers", label: "By source" },
];

/** Group skills by their source repo (or the skills.sh match); untracked skills go last. */
function groupBySource(skills: Skill[]): Array<{ key: string; owner: string | null; skills: Skill[] }> {
  const groups = new Map<string, Skill[]>();
  for (const skill of skills) {
    const key = skill.lock?.source ?? skill.registry?.source ?? (skill.inHub ? "No source recorded" : "Not in the hub");
    const list = groups.get(key);
    if (list === undefined) groups.set(key, [skill]);
    else list.push(skill);
  }
  const untracked = new Set(["No source recorded", "Not in the hub"]);
  return [...groups.entries()]
    .map(([key, list]) => ({ key, owner: untracked.has(key) ? null : (key.split("/")[0] ?? null), skills: list }))
    .sort((a, b) => {
      const ua = untracked.has(a.key) ? 1 : 0;
      const ub = untracked.has(b.key) ? 1 : 0;
      if (ua !== ub) return ua - ub;
      return b.skills.length - a.skills.length || a.key.localeCompare(b.key);
    });
}

function hasUpdate(skill: Skill): boolean {
  return skill.update?.state === "update-available" || skill.update?.state === "modified-and-update";
}

function isMissingSomewhere(skill: Skill, agents: Agent[]): boolean {
  return skill.inHub && agents.some((agent) => (skill.cells[agent.id]?.state ?? "missing") === "missing");
}

export function InstalledPage({
  status,
  rpc,
  mutations,
  refetch,
  onOpen,
}: {
  status: Status;
  rpc: Rpc;
  mutations: Mutations;
  refetch: () => void;
  onOpen: (skill: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [view, setView] = useState<View>("grid");
  const [agentFilter, setAgentFilter] = useState<string | null>(null);
  const [showAllAgents, setShowAllAgents] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [tagFilter, setTagFilter] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const toggleGroup = (key: string) =>
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const agents = useMemo(() => status.agents.filter((agent) => showAllAgents || agent.active), [status, showAllAgents]);

  const focus = agentFilter !== null ? status.agents.find((agent) => agent.id === agentFilter) : undefined;

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const rows = status.skills.filter((skill) => {
      if (needle !== "" && !skill.name.includes(needle) && !skill.description.toLowerCase().includes(needle)) return false;
      if (tagFilter === UNTAGGED && skill.tags.length > 0) return false;
      if (tagFilter !== null && tagFilter !== UNTAGGED && !skill.tags.includes(tagFilter)) return false;
      // In an agent's view, skills it lacks stay visible (dimmed, with Add) only when the hub can supply them.
      if (focus !== undefined && (skill.cells[focus.id]?.state ?? "missing") === "missing" && !skill.inHub) return false;
      return true;
    });
    if (focus === undefined) return rows;
    // The agent's own skills first, then what it could add.
    const has = (skill: Skill) => (skill.cells[focus.id]?.state ?? "missing") !== "missing";
    return [...rows.filter(has), ...rows.filter((skill) => !has(skill))];
  }, [status, query, tagFilter, focus]);
  const untaggedCount = status.skills.filter((skill) => skill.tags.length === 0).length;

  const hubSkills = status.skills.filter((skill) => skill.inHub);
  const targets = focus !== undefined ? [focus] : agents;
  const missingCount = status.skills.filter((skill) => isMissingSomewhere(skill, targets)).length;
  const updateCount = status.skills.filter(hasUpdate).length;
  const tracked = status.skills.filter((skill) => skill.lock !== undefined).length;
  const toggle = (name: string) => setSelected((current) => (current === name ? null : name));

  return (
    <>
      <Dashboard
        status={status}
        agents={agents}
        mutations={mutations}
        selectedAgent={agentFilter}
        onSelectAgent={setAgentFilter}
      />

      {/* Toolbar: search, then actions, then view controls */}
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Filter skills…" aria-label="Filter skills" className="h-8 w-56" />
        <Button size="sm" variant="outline" disabled={mutations.busy || tracked === 0} onClick={() => void mutations.checkUpdates()}>
          <Icon name="ArrowReloadHorizontal" className="size-4" />
          Check updates
        </Button>
        {updateCount > 0 ? (
          <Button size="sm" variant="outline" disabled={mutations.busy} onClick={() => void mutations.update()}>
            Update {updateCount}
          </Button>
        ) : null}
        <Button
          size="sm"
          disabled={mutations.busy || missingCount === 0}
          onClick={() => void mutations.sync(hubSkills.map((skill) => skill.name), targets.map((agent) => agent.id), status.defaultMode)}
        >
          <Icon name="Download" className="size-4" />
          {missingCount === 0
            ? focus !== undefined
              ? `${focus.label} has everything`
              : "All installed"
            : focus !== undefined
              ? `Add ${missingCount} to ${focus.label}`
              : `Install missing (${missingCount})`}
        </Button>
        <span className="ml-auto flex items-center gap-1">
          <span className="flex rounded-md border border-border p-0.5">
            {VIEWS.map((option) => (
              <Button
                key={option.key}
                variant="ghost"
                size="icon"
                className={cn("size-7", view === option.key && "bg-state-active text-foreground")}
                aria-label={option.label}
                aria-pressed={view === option.key}
                onClick={() => setView(option.key)}
              >
                <Icon name={option.icon} className="size-4" />
              </Button>
            ))}
          </span>
          <Button variant="ghost" size="icon" className="size-8" aria-label="Rescan" onClick={refetch}>
            <Icon name="RotateCcw" className="size-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="size-8"
            aria-label={showAllAgents ? "Hide agents that are not installed" : "Show every agent"}
            aria-pressed={showAllAgents}
            onClick={() => setShowAllAgents((value) => !value)}
          >
            <Icon name={showAllAgents ? "EyeOff" : "Eye"} className="size-4" />
          </Button>
        </span>
      </div>

      <div className="mt-2">
        <TagFilter tags={status.tags} untaggedCount={untaggedCount} selected={tagFilter} onSelect={setTagFilter} />
      </div>


      {visible.length === 0 ? (
        <div className="mt-3 rounded-lg border border-border bg-card">
          <Empty>{status.skills.length === 0 ? "No skills found in the hub or any agent." : "Nothing matches."}</Empty>
        </div>
      ) : view === "groups" ? (
        <div className="mt-3 space-y-5">
          {groupBySource(visible).map((group) => {
            const open = !collapsed.has(group.key);
            return (
            <section key={group.key}>
              <button
                type="button"
                onClick={() => toggleGroup(group.key)}
                aria-expanded={open}
                className="mb-2 flex w-full items-center gap-2.5 rounded-md py-1 pr-2 text-left transition-colors hover:bg-state-hover"
              >
                <Icon name="ChevronRight" className={cn("size-3.5 shrink-0 text-subtle-foreground transition-transform", open && "rotate-90")} />
                <OwnerAvatar owner={group.owner} letter={group.key} className="size-6" />
                <span className="text-sm font-medium">{group.key}</span>
                <span className="text-xs tabular-nums text-muted-foreground">{group.skills.length}</span>
              </button>
              {open ? (
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {group.skills.map((skill) => (
                  <SkillCardSlot
                    key={skill.name}
                    skill={skill}
                    agents={agents}
                    status={status}
                    rpc={rpc}
                    mutations={mutations}
                    selected={selected === skill.name}
                    onSelect={() => toggle(skill.name)}
                    onOpen={() => onOpen(skill.name)}
                    focus={focus}
                  />
                ))}
              </div>
              ) : null}
            </section>
            );
          })}
        </div>
      ) : view === "grid" ? (
        <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {visible.map((skill) => (
            <SkillCardSlot
              key={skill.name}
              skill={skill}
              agents={agents}
              status={status}
              rpc={rpc}
              mutations={mutations}
              selected={selected === skill.name}
              onSelect={() => toggle(skill.name)}
              onOpen={() => onOpen(skill.name)}
              focus={focus}
            />
          ))}
        </div>
      ) : (
        <div className="mt-3 overflow-hidden rounded-lg border border-border bg-card">
          <ul>
            {visible.map((skill) => (
              <SkillRow
                key={skill.name}
                skill={skill}
                agents={agents}
                status={status}
                rpc={rpc}
                mutations={mutations}
                expanded={selected === skill.name}
                onToggle={() => toggle(skill.name)}
                onOpen={() => onOpen(skill.name)}
                focus={focus}
              />
            ))}
          </ul>
        </div>
      )}
    </>
  );
}

/** A card plus, when selected, its full-width detail block right after it. */
function SkillCardSlot({
  skill,
  agents,
  status,
  rpc,
  mutations,
  selected,
  onSelect,
  onOpen,
  focus,
}: {
  skill: Skill;
  agents: Agent[];
  status: Status;
  rpc: Rpc;
  mutations: Mutations;
  selected: boolean;
  onSelect: () => void;
  onOpen: () => void;
  focus?: Agent;
}) {
  return (
    <>
      <SkillCard skill={skill} agents={agents} status={status} mutations={mutations} selected={selected} onSelect={onSelect} onOpen={onOpen} focus={focus} />
      {selected ? <SkillCardDetail skill={skill} agents={agents} status={status} rpc={rpc} mutations={mutations} focus={focus} /> : null}
    </>
  );
}
