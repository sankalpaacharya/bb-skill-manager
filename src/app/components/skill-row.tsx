// One skill in the list view: collapsed summary with per-agent marks,
// expanding to the shared detail block.
import { Icon } from "@/components/ui/icon";
import { cn } from "@/lib/utils";
import type { Mutations } from "../hooks/use-mutations";
import { formatCount } from "../lib/format";
import type { Agent, Rpc, Skill, Status } from "../lib/types";
import { CELL_META } from "../lib/meta";
import { AgentMark, Pill, SkillLogo, SkillStatus } from "./primitives";
import { SkillDetail } from "./skill-detail";
import { TagPicker } from "./tag-picker";
import { TagChip } from "./tags";

const hoverIcon =
  "inline-flex size-6 items-center justify-center rounded-md text-subtle-foreground transition-colors hover:bg-state-hover hover:text-foreground";

export function SkillRow({
  skill,
  agents,
  status,
  rpc,
  mutations,
  expanded,
  onToggle,
  onOpen,
  focus,
}: {
  skill: Skill;
  agents: Agent[];
  status: Status;
  rpc: Rpc;
  mutations: Mutations;
  expanded: boolean;
  onToggle: () => void;
  onOpen: () => void;
  focus?: Agent;
}) {
  const focusState = focus !== undefined ? (skill.cells[focus.id]?.state ?? "missing") : null;
  return (
    <li className={cn("group border-b border-border-hairline last:border-b-0", focusState === "missing" && "opacity-60 hover:opacity-100")}>
      <div
        role="button"
        tabIndex={0}
        onClick={onToggle}
        onKeyDown={(event) => {
          if (event.target !== event.currentTarget) return;
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            onToggle();
          }
        }}
        aria-expanded={expanded}
        className="flex w-full cursor-pointer items-center gap-3 px-3 py-2.5 text-left transition-colors hover:bg-state-hover focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
      >
        <Icon name="ChevronRight" className={cn("size-3.5 shrink-0 text-subtle-foreground transition-transform", expanded && "rotate-90")} />
        <SkillLogo skill={skill} className="size-7" />
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2">
            <span className="truncate text-sm font-medium">{skill.name}</span>
            {focusState !== null ? (
              focusState === "missing" ? (
                <span className="text-[11px] text-subtle-foreground">not in {focus?.label}</span>
              ) : (
                <Pill tone={CELL_META[focusState].tone} title={CELL_META[focusState].title}>
                  {CELL_META[focusState].label}
                </Pill>
              )
            ) : (
              <SkillStatus skill={skill} agents={agents} />
            )}
            {skill.lock !== undefined ? <span className="truncate font-mono text-[11px] text-subtle-foreground">{skill.lock.source}</span> : null}
            {skill.registry !== undefined ? (
              <span className="shrink-0 text-[11px] tabular-nums text-subtle-foreground" title={`${skill.registry.installs.toLocaleString()} installs on skills.sh`}>
                <Icon name="Download" className="mr-0.5 inline size-3 align-[-2px]" style={{ color: "var(--primary)" }} />
                {formatCount(skill.registry.installs)}
              </span>
            ) : null}
            {(skill.registry?.stars ?? skill.stars) != null ? (
              <span className="shrink-0 text-[11px] tabular-nums text-subtle-foreground" title={`${(skill.registry?.stars ?? skill.stars ?? 0).toLocaleString()} stars on GitHub`}>
                <Icon name="Star" className="mr-0.5 inline size-3 align-[-2px]" style={{ color: "var(--warning)" }} />
                {formatCount(skill.registry?.stars ?? skill.stars ?? 0)}
              </span>
            ) : null}
            {skill.tags.map((tag) => (
              <TagChip key={tag} tag={tag} />
            ))}
          </span>
        </span>
        <span className="flex items-center opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
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
        </span>
        {focus === undefined ? (
          <span className="hidden flex-wrap justify-end gap-1.5 sm:flex">
            {agents.map((agent) => (
              <AgentMark key={agent.id} agent={agent} state={skill.cells[agent.id]?.state ?? "missing"} />
            ))}
          </span>
        ) : null}
      </div>
      {expanded ? (
        <div className="border-t border-border-hairline bg-surface-raised px-3 pb-2 pl-9">
          <SkillDetail skill={skill} agents={focus !== undefined ? [focus] : agents} status={status} rpc={rpc} mutations={mutations} />
        </div>
      ) : null}
    </li>
  );
}
