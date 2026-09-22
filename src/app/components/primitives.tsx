// Small presentational pieces shared across the page.
import { useState, type CSSProperties, type ReactNode } from "react";
import { experimental_ProviderIcon as ProviderIcon, experimental_useProviders as useProviders } from "@get-bb/plugin-sdk/app";
import { cn } from "@/lib/utils";
import { CELL_META, isDrifted } from "../lib/meta";
import type { Agent, CellState, Skill } from "../lib/types";

export function Dot({ tone, hollow = false, className }: { tone: string; hollow?: boolean; className?: string }) {
  const style: CSSProperties = hollow
    ? { boxShadow: "inset 0 0 0 1.5px var(--muted-foreground)", opacity: 0.5 }
    : { backgroundColor: tone };
  return <span aria-hidden className={cn("inline-block size-2 shrink-0 rounded-full", className)} style={style} />;
}

export function CellDot({ state, className }: { state: CellState; className?: string }) {
  if (state === "hub") {
    // Ring rather than a filled dot: the agent sees the skill, but through the hub.
    return (
      <span
        aria-hidden
        className={cn("inline-block size-2 shrink-0 rounded-full", className)}
        style={{ boxShadow: `inset 0 0 0 1.5px ${CELL_META.hub.tone}` }}
      />
    );
  }
  return <Dot tone={CELL_META[state].tone} hollow={state === "missing"} className={className} />;
}

/** The agent's harness logo via BB's provider artwork, or its initial. */
export function AgentLogo({ agent, className }: { agent: Agent; className?: string }) {
  const { providers } = useProviders();
  if (agent.providerId !== undefined) {
    const provider = providers.find((candidate) => candidate.id === agent.providerId) ?? { id: agent.providerId };
    return <ProviderIcon providerKind="agent" provider={provider} className={className} aria-hidden />;
  }
  return (
    <span aria-hidden className={cn("inline-flex items-center justify-center rounded-sm bg-muted text-[9px] font-semibold leading-none", className)}>
      {agent.label.slice(0, 1)}
    </span>
  );
}

/** Logo with a state dot in the corner; dimmed when the agent lacks the skill. */
export function AgentMark({ agent, state }: { agent: Agent; state: CellState }) {
  return (
    <span
      title={`${agent.label}: ${CELL_META[state].title}`}
      className={cn("relative inline-flex size-[18px] items-center justify-center opacity-70", state === "missing" && "opacity-15 grayscale")}
    >
      <AgentLogo agent={agent} className="size-3" />
      {state !== "missing" ? <CellDot state={state} className="absolute -right-px -top-px size-[5px] ring-[1.5px] ring-card" /> : null}
    </span>
  );
}

export function Pill({ children, tone, title, className }: { children: ReactNode; tone?: string; title?: string; className?: string }) {
  return (
    <span
      title={title}
      className={cn("inline-flex h-5 items-center gap-1.5 rounded-full border border-border bg-secondary px-2 text-[11px] leading-none text-foreground", className)}
    >
      {tone !== undefined ? <Dot tone={tone} className="size-1.5" /> : null}
      {children}
    </span>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="p-8 text-center text-sm text-muted-foreground">{children}</p>;
}

export function SegmentedControl<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: Array<{ key: T; label: string }>;
  onChange: (value: T) => void;
}) {
  return (
    <div className="flex rounded-md border border-border p-0.5">
      {options.map((option) => (
        <button
          key={option.key}
          type="button"
          onClick={() => onChange(option.key)}
          aria-pressed={value === option.key}
          className={cn(
            "rounded px-2.5 py-1 text-xs transition-colors",
            value === option.key ? "bg-state-active text-foreground" : "text-muted-foreground hover:text-foreground",
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------- skills ----

/** Owner of a GitHub/GitLab source, for the avatar. */
function sourceOwner(skill: Skill): { host: "github" | "gitlab"; owner: string } | null {
  const lock = skill.lock;
  if (lock === undefined) return null;
  if (lock.sourceType !== "github" && lock.sourceType !== "gitlab") return null;
  const owner = lock.source.split("/")[0];
  return owner === undefined || owner === "" ? null : { host: lock.sourceType, owner };
}

/**
 * The avatar of a GitHub/GitLab owner, falling back to a letter tile when
 * there is no owner or the image fails to load (offline, blocked).
 */
export function OwnerAvatar({
  owner,
  host = "github",
  letter,
  className,
}: {
  owner: string | null;
  host?: "github" | "gitlab";
  letter: string;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);
  const tile = (
    <span
      aria-hidden
      className={cn("inline-flex shrink-0 items-center justify-center rounded-md bg-secondary text-xs font-semibold uppercase text-muted-foreground", className)}
    >
      {letter.slice(0, 1)}
    </span>
  );
  if (owner === null || owner === "" || failed) return tile;
  const src = host === "github" ? `https://github.com/${owner}.png?size=64` : `https://gitlab.com/${owner}.png?width=64`;
  return <img src={src} alt="" loading="lazy" onError={() => setFailed(true)} className={cn("shrink-0 rounded-md bg-secondary object-cover", className)} />;
}

/** A skill has no logo of its own in the Agent Skills spec, so we show its source owner's avatar. */
export function SkillLogo({ skill, className }: { skill: Skill; className?: string }) {
  const owner = sourceOwner(skill);
  return <OwnerAvatar owner={owner?.owner ?? null} host={owner?.host} letter={skill.name} className={className} />;
}

export type SkillHealth = "synced" | "drifted" | "update" | "unmanaged" | "partial" | "broken";

/** Roll a skill's per-agent states and update check into one badge. */
export function skillHealth(skill: Skill, agents: Agent[]): { health: SkillHealth; label: string; tone: string } {
  const states = agents.map((agent) => skill.cells[agent.id]?.state ?? "missing");
  if (states.includes("broken")) return { health: "broken", label: "Broken", tone: "var(--destructive)" };
  if (!skill.inHub) return { health: "unmanaged", label: "Not in hub", tone: "var(--pr-merged)" };
  if (skill.update?.state === "update-available" || skill.update?.state === "modified-and-update") {
    return { health: "update", label: "Update available", tone: "var(--primary)" };
  }
  if (states.some(isDrifted)) return { health: "drifted", label: "Drifted", tone: "var(--warning)" };
  const missing = states.filter((state) => state === "missing").length;
  if (missing === agents.length && agents.length > 0) return { health: "partial", label: "Not installed", tone: "var(--muted-foreground)" };
  if (missing > 0) return { health: "partial", label: `Missing in ${missing}`, tone: "var(--attention)" };
  return { health: "synced", label: "In sync", tone: "var(--success)" };
}

export function SkillStatus({ skill, agents }: { skill: Skill; agents: Agent[] }) {
  const { label, tone } = skillHealth(skill, agents);
  return (
    <Pill tone={tone} className="shrink-0">
      {label}
    </Pill>
  );
}
