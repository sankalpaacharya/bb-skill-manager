// One skill in the grid view. The selected card's detail renders as a
// full-width block right after it.
import type { KeyboardEvent, MouseEvent } from "react";
import { Icon } from "@/components/ui/icon";
import { cn } from "@/lib/utils";
import type { Mutations } from "../hooks/use-mutations";
import { formatCount } from "../lib/format";
import type { Agent, Rpc, Skill, Status } from "../lib/types";
import { AgentMark, Pill, SkillLogo, SkillStatus } from "./primitives";
import { CELL_META } from "../lib/meta";
import { SkillDetail } from "./skill-detail";
import { TagPicker } from "./tag-picker";
import { TagChip } from "./tags";

const hoverIcon =
  "inline-flex size-6 items-center justify-center rounded-md text-subtle-foreground transition-colors hover:bg-state-hover hover:text-foreground disabled:opacity-50";

export function SkillCard({
  skill,
  agents,
  status,
  mutations,
  selected,
  onSelect,
  onOpen,
  focus,
}: {
  skill: Skill;
  agents: Agent[];
  status: Status;
  mutations: Mutations;
  selected: boolean;
  onSelect: () => void;
  onOpen: () => void;
  /** When set, the card describes this one agent's relationship to the skill. */
  focus?: Agent;
}) {
  const tracked = skill.lock !== undefined;
  const focusState = focus !== undefined ? (skill.cells[focus.id]?.state ?? "missing") : null;
  const absent = focusState === "missing";
  const updateState = skill.update?.state;
  const hasUpdate = updateState === "update-available" || updateState === "modified-and-update";
  const onKey = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.target !== event.currentTarget) return;
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      onSelect();
    }
  };
  const refresh = (event: MouseEvent) => {
    event.stopPropagation();
    void mutations.refresh(skill.name);
  };
  return (
    // A div rather than a button so the update control can be a real button inside it.
    <div
      role="button"
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={onKey}
      aria-expanded={selected}
      className={cn(
        "group relative flex h-full cursor-pointer flex-col gap-2.5 rounded-lg border p-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
        selected ? "border-primary/60 bg-surface-selected" : "border-border bg-card hover:bg-state-hover",
        absent && "opacity-60 hover:opacity-100",
      )}
    >
      <span className="flex items-center gap-2.5">
        <SkillLogo skill={skill} className="size-8" />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium">{skill.name}</span>
          <span className="flex items-center gap-2 text-[11px] text-subtle-foreground">
            <span className="truncate font-mono">
              {skill.lock?.source ?? (skill.registry !== undefined ? `${skill.registry.source}?` : skill.inHub ? "no source recorded" : "not in hub")}
            </span>
            {skill.registry !== undefined ? (
              <span className="shrink-0 tabular-nums" title={`${skill.registry.installs.toLocaleString()} installs on skills.sh`}>
                <Icon name="Download" className="mr-0.5 inline size-3 align-[-2px]" />
                {formatCount(skill.registry.installs)}
              </span>
            ) : skill.lock?.sourceType === "github" && skill.registryChecked !== true ? (
              // Figures are still loading for this tracked skill.
              <span aria-hidden className="inline-block h-3 w-8 shrink-0 animate-pulse rounded bg-muted" />
            ) : null}
            {(skill.registry?.stars ?? skill.stars) != null ? (
              <span className="shrink-0 tabular-nums" title={`${(skill.registry?.stars ?? skill.stars ?? 0).toLocaleString()} stars on GitHub`}>
                <Icon name="Star" className="mr-0.5 inline size-3 align-[-2px]" />
                {formatCount(skill.registry?.stars ?? skill.stars ?? 0)}
              </span>
            ) : null}
          </span>
        </span>
        <span className="absolute right-2 top-2 flex items-center rounded-md bg-card/90 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
          <TagPicker skill={skill.name} tags={skill.tags} allTags={status.tags} mutations={mutations}>
            <button type="button" onClick={(event) => event.stopPropagation()} aria-label={`Tag ${skill.name}`} title="Tags" className={hoverIcon}>
              <Icon name="Pin" className="size-3.5" />
            </button>
          </TagPicker>
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              onOpen();
            }}
            aria-label={`Read ${skill.name}`}
            title="Read"
            className={hoverIcon}
          >
            <Icon name="FileText" className="size-3.5" />
          </button>
          {tracked && !hasUpdate ? (
            <button type="button" onClick={refresh} disabled={mutations.busy} aria-label={`Check ${skill.name} for updates`} title="Check for updates" className={hoverIcon}>
              <Icon name="ArrowReloadHorizontal" className="size-3.5" />
            </button>
          ) : null}
        </span>
      </span>
      {skill.tags.length > 0 ? (
        <span className="flex flex-wrap gap-1">
          {skill.tags.map((tag) => (
            <TagChip key={tag} tag={tag} />
          ))}
        </span>
      ) : null}
      <span className="mt-auto flex items-center justify-between gap-2 pt-1">
        {focus !== undefined && focusState !== null ? (
          absent ? (
            <>
              <span className="text-[11px] text-subtle-foreground">Not in {focus.label}</span>
              {skill.inHub ? (
                <button
                  type="button"
                  disabled={mutations.busy}
                  onClick={(event) => {
                    event.stopPropagation();
                    void mutations.sync([skill.name], [focus.id], status.defaultMode);
                  }}
                  className="inline-flex h-6 items-center gap-1 rounded-full bg-primary/15 px-2 text-[11px] font-medium text-primary transition-colors hover:bg-primary/25 disabled:opacity-50"
                >
                  <Icon name="Plus" className="size-3" />
                  Add
                </button>
              ) : null}
            </>
          ) : (
            <Pill tone={CELL_META[focusState].tone} title={CELL_META[focusState].title}>
              {CELL_META[focusState].label}
            </Pill>
          )
        ) : (
          <>
            {hasUpdate ? (
              <button
                type="button"
                onClick={refresh}
                disabled={mutations.busy}
                title="A newer version is available"
                className="inline-flex h-6 shrink-0 items-center gap-1 rounded-full bg-primary/15 px-2 text-[11px] font-medium text-primary transition-colors hover:bg-primary/25 disabled:opacity-50"
              >
                <Icon name="ArrowUp" className="size-3" />
                Update
              </button>
            ) : (
              <SkillStatus skill={skill} agents={agents} />
            )}
            <span className="flex min-w-0 flex-wrap justify-end gap-0.5">
              {agents.map((agent) => (
                <AgentMark key={agent.id} agent={agent} state={skill.cells[agent.id]?.state ?? "missing"} />
              ))}
            </span>
          </>
        )}
      </span>
    </div>
  );
}

export function SkillCardDetail({
  skill,
  agents,
  status,
  rpc,
  mutations,
  focus,
}: {
  skill: Skill;
  agents: Agent[];
  status: Status;
  rpc: Rpc;
  mutations: Mutations;
  focus?: Agent;
}) {
  return (
    <div className="col-span-full rounded-lg border border-primary/40 bg-surface-raised px-4 pb-3 pt-1">
      <SkillDetail skill={skill} agents={focus !== undefined ? [focus] : agents} status={status} rpc={rpc} mutations={mutations} />
    </div>
  );
}
