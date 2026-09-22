// Expanded detail for one skill: source and update state, then one line per
// agent with inline actions. Used by both the list row and the card grid.
import { useState, type FormEvent, type ReactNode } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { Mutations } from "../hooks/use-mutations";
import { describeError, homeOf, tildify, timeAgo } from "../lib/format";
import { CELL_META, UPDATE_META } from "../lib/meta";
import type { Agent, DiffResponse, Rpc, Skill, Status } from "../lib/types";
import { DiffView } from "./diff-view";
import { AgentLogo, CellDot, Pill } from "./primitives";

export function SmallButton({
  children,
  onClick,
  disabled,
  variant = "outline",
}: {
  children: ReactNode;
  onClick: () => void;
  disabled?: boolean;
  variant?: "default" | "outline" | "destructive";
}) {
  return (
    <Button size="sm" variant={variant} disabled={disabled} onClick={onClick} className="h-7 px-2.5 text-xs">
      {children}
    </Button>
  );
}

function SourceSection({ skill, mutations }: { skill: Skill; mutations: Mutations }) {
  const [editing, setEditing] = useState(false);
  const [source, setSource] = useState("");
  const update = skill.update;

  const save = async (event?: FormEvent) => {
    event?.preventDefault();
    const value = source.trim();
    if (value === "") return;
    if (await mutations.setSource(skill.name, value)) {
      setEditing(false);
      setSource("");
    }
  };

  if (!skill.inHub) {
    return (
      <p className="py-2 text-xs text-muted-foreground">
        Not in the hub. Adopt it from an agent below to manage it and record a source.
      </p>
    );
  }
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 py-2 text-xs">
      <span className="w-32 shrink-0 text-muted-foreground">Source</span>
      {skill.lock !== undefined ? (
        <>
          <span className="font-mono">{skill.lock.source}</span>
          <span className="truncate font-mono text-subtle-foreground">{skill.lock.skillPath}</span>
        </>
      ) : (
        <span className="text-muted-foreground">unknown</span>
      )}
      {update !== undefined ? (
        <Pill tone={UPDATE_META[update.state].tone} title={update.message ?? UPDATE_META[update.state].title}>
          {UPDATE_META[update.state].label} · {timeAgo(update.checkedAt)}
        </Pill>
      ) : null}
      <span className="ml-auto flex flex-wrap gap-1.5">
        {skill.lock !== undefined ? (
          <SmallButton disabled={mutations.busy} onClick={() => void mutations.checkUpdates([skill.name])}>
            Check
          </SmallButton>
        ) : null}
        {update?.state === "update-available" ? (
          <SmallButton variant="default" disabled={mutations.busy} onClick={() => void mutations.update([skill.name])}>
            Update
          </SmallButton>
        ) : null}
        {update?.state === "modified-and-update" ? (
          <SmallButton variant="destructive" disabled={mutations.busy} onClick={() => void mutations.update([skill.name], true)}>
            Update (discard edits)
          </SmallButton>
        ) : null}
        {skill.lock === undefined && skill.registry !== undefined ? (
          <SmallButton variant="default" disabled={mutations.busy} onClick={() => void mutations.setSource(skill.name, skill.registry?.id ?? "")}>
            Use {skill.registry.source}
          </SmallButton>
        ) : null}
        <SmallButton onClick={() => setEditing((value) => !value)}>{skill.lock === undefined ? "Set source" : "Change"}</SmallButton>
      </span>
      {editing ? (
        <form onSubmit={(event) => void save(event)} className="flex w-full items-center gap-2 pl-32">
          <Input
            value={source}
            onChange={(event) => setSource(event.target.value)}
            placeholder="owner/repo@skill · owner/repo/path · https://github.com/…"
            className="h-7 text-xs"
            autoFocus
          />
          <SmallButton variant="default" disabled={mutations.busy || source.trim() === ""} onClick={() => void save()}>
            Save
          </SmallButton>
        </form>
      ) : null}
    </div>
  );
}

function AgentLine({ skill, agent, status, rpc, mutations }: { skill: Skill; agent: Agent; status: Status; rpc: Rpc; mutations: Mutations }) {
  const [diff, setDiff] = useState<DiffResponse | null>(null);
  const cell = skill.cells[agent.id];
  const state = cell?.state ?? "missing";
  const home = homeOf(status);
  const { busy } = mutations;
  const name = skill.name;
  const id = agent.id;

  const toggleDiff = async () => {
    if (diff !== null) return setDiff(null);
    try {
      setDiff(await rpc.call("diff", { skill: name, agent: id }));
    } catch (cause) {
      toast.error(describeError(cause));
    }
  };

  const actions: ReactNode[] = [];
  const add = (key: string, label: string, onClick: () => void, variant: "default" | "outline" | "destructive" = "outline") =>
    actions.push(
      <SmallButton key={key} variant={variant} disabled={busy} onClick={onClick}>
        {label}
      </SmallButton>,
    );

  if (state === "hub") add("linkanyway", "Add a link anyway", () => void mutations.sync([name], [id], "link", true));
  if (skill.inHub && (state === "missing" || state === "broken")) {
    add("link", "Link", () => void mutations.sync([name], [id], "link", state === "broken"), "default");
    add("copy", "Copy", () => void mutations.sync([name], [id], "copy", state === "broken"));
  }
  if (state === "same") add("relink", "Replace with link", () => void mutations.sync([name], [id], "link"));
  if (state === "modified" || state === "external-link") {
    add("diff", diff === null ? "Diff" : "Hide diff", () => void toggleDiff());
    add("hub", "Use hub version", () => void mutations.sync([name], [id], "link", true), "destructive");
    add("adopt", "Use this version", () => void mutations.adopt(name, id, true), "destructive");
  }
  if (state === "unmanaged") add("adopt", "Adopt into hub", () => void mutations.adopt(name, id), "default");
  if (state !== "missing" && state !== "hub") {
    const risky = state === "modified" || state === "unmanaged";
    add("remove", risky ? "Delete" : "Remove", () => void mutations.remove(name, [id], risky), risky ? "destructive" : "outline");
  }

  return (
    <li className="py-2">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <span className="flex w-32 shrink-0 items-center gap-2 text-sm">
          <AgentLogo agent={agent} className="size-4" />
          {agent.label}
          <CellDot state={state} />
        </span>
        <span className="text-xs text-muted-foreground">{CELL_META[state].title}</span>
        <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-subtle-foreground" title={cell?.path}>
          {cell !== undefined ? tildify(cell.target ?? cell.path, home) : tildify(agent.dir, home)}
        </span>
        <span className="flex flex-wrap gap-1.5">{actions}</span>
      </div>
      {diff !== null ? (
        <div className="mt-2">
          <DiffView diff={diff} />
        </div>
      ) : null}
    </li>
  );
}

export function SkillDetail({
  skill,
  agents,
  status,
  rpc,
  mutations,
}: {
  skill: Skill;
  agents: Agent[];
  status: Status;
  rpc: Rpc;
  mutations: Mutations;
}) {
  const missingAgents = skill.inHub
    ? agents.filter((agent) => (skill.cells[agent.id]?.state ?? "missing") === "missing").map((agent) => agent.id)
    : [];
  return (
    <div>
      <SourceSection skill={skill} mutations={mutations} />
      <ul className="divide-y divide-border-hairline border-t border-border-hairline">
        {agents.map((agent) => (
          <AgentLine key={agent.id} skill={skill} agent={agent} status={status} rpc={rpc} mutations={mutations} />
        ))}
      </ul>
      {missingAgents.length > 1 ? (
        <div className="pt-2">
          <SmallButton disabled={mutations.busy} onClick={() => void mutations.sync([skill.name], missingAgents, status.defaultMode)}>
            Install into all {missingAgents.length} missing agents
          </SmallButton>
        </div>
      ) : null}
    </div>
  );
}
