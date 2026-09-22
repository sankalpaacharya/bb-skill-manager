// Reader: a skill list on the left (the selected skill expands to show its
// files), the selected file on the right. Only the two panes scroll; the
// page itself stays fixed.
import { useEffect, useMemo, useRef, useState } from "react";
import { Markdown, experimental_SourceCode as SourceCode } from "@get-bb/plugin-sdk/app";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { describeError, homeOf, tildify } from "../lib/format";
import type { Agent, Rpc, Skill, Status } from "../lib/types";
import { AgentLogo, SkillLogo } from "./primitives";

interface FileEntry {
  path: string;
  sizeBytes: number;
}

interface Loaded {
  path: string;
  content: string;
  truncated: boolean;
  binary: boolean;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Agents whose copy can be opened: real directories, not hub links or via-hub. */
function readableAgents(skill: Skill, agents: Agent[]): Agent[] {
  return agents.filter((agent) => {
    const state = skill.cells[agent.id]?.state ?? "missing";
    return state === "same" || state === "modified" || state === "unmanaged" || state === "external-link";
  });
}

function readable(skill: Skill): boolean {
  return skill.inHub || Object.values(skill.cells).some((cell) => cell.state !== "missing" && cell.state !== "hub" && cell.state !== "broken");
}

export function SkillReader({
  initial,
  status,
  rpc,
  onClose,
}: {
  initial: string;
  status: Status;
  rpc: Rpc;
  onClose: () => void;
}) {
  const [current, setCurrent] = useState(initial);
  const [query, setQuery] = useState("");
  const [agent, setAgent] = useState<string | null>(null);
  const [dir, setDir] = useState("");
  const [files, setFiles] = useState<FileEntry[] | null>(null);
  const [selected, setSelected] = useState("SKILL.md");
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const contentRef = useRef<HTMLDivElement>(null);

  const skill = status.skills.find((candidate) => candidate.name === current) ?? status.skills[0];
  const copies = skill === undefined ? [] : readableAgents(skill, status.agents);
  const home = homeOf(status);

  const list = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return status.skills.filter((candidate) => readable(candidate) && (needle === "" || candidate.name.includes(needle)));
  }, [status, query]);

  const pick = (name: string) => {
    if (name === current) return;
    setCurrent(name);
    setAgent(null);
    setSelected("SKILL.md");
  };

  // File list for the current skill and copy.
  useEffect(() => {
    if (skill === undefined) return;
    let cancelled = false;
    setFiles(null);
    rpc.call("skillFiles", { skill: skill.name, ...(agent === null ? {} : { agent }) }).then(
      (result) => {
        if (cancelled) return;
        setDir(result.dir);
        setFiles(result.files);
        if (!result.files.some((file) => file.path === selected)) {
          setSelected(result.files.some((file) => file.path === "SKILL.md") ? "SKILL.md" : (result.files[0]?.path ?? ""));
        }
      },
      (cause: unknown) => toast.error(describeError(cause)),
    );
    return () => {
      cancelled = true;
    };
    // `selected` is intentionally not a dependency: it is reconciled inside.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rpc, skill?.name, agent]);

  // The selected file.
  useEffect(() => {
    if (skill === undefined || selected === "") return;
    let cancelled = false;
    rpc.call("skillFile", { skill: skill.name, path: selected, ...(agent === null ? {} : { agent }) }).then(
      (result) => {
        if (cancelled) return;
        setLoaded(result);
        contentRef.current?.scrollTo({ top: 0 });
      },
      (cause: unknown) => toast.error(describeError(cause)),
    );
    return () => {
      cancelled = true;
    };
  }, [rpc, skill?.name, agent, selected]);

  if (skill === undefined) return null;
  const isMarkdown = /\.(md|mdx|markdown)$/i.test(selected);
  const showing = loaded !== null && loaded.path === selected ? loaded : null;

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Header */}
      <div className="flex shrink-0 flex-wrap items-center gap-3 pb-3">
        <Button variant="ghost" size="icon" className="size-8" aria-label="Back to skills" onClick={onClose}>
          <Icon name="ChevronLeft" className="size-4" />
        </Button>
        <SkillLogo skill={skill} className="size-8" />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium">{skill.name}</span>
          <span className="block truncate font-mono text-[11px] text-subtle-foreground">{tildify(dir, home)}</span>
        </span>
        {copies.length > 0 ? (
          <span className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setAgent(null)}
              aria-pressed={agent === null}
              disabled={!skill.inHub}
              title={skill.inHub ? "Hub copy" : "Not in the hub"}
              className={cn(
                "inline-flex h-7 items-center rounded-md border px-2 text-xs",
                agent === null ? "border-primary/60 bg-surface-selected" : "border-border text-muted-foreground",
                !skill.inHub && "opacity-40",
              )}
            >
              hub
            </button>
            {copies.map((candidate) => (
              <button
                key={candidate.id}
                type="button"
                onClick={() => setAgent(candidate.id)}
                aria-pressed={agent === candidate.id}
                title={`${candidate.label}'s own copy`}
                className={cn(
                  "inline-flex h-7 items-center gap-1.5 rounded-md border px-2 text-xs",
                  agent === candidate.id ? "border-primary/60 bg-surface-selected" : "border-border text-muted-foreground",
                )}
              >
                <AgentLogo agent={candidate} className="size-3.5" />
                {candidate.label}
              </button>
            ))}
          </span>
        ) : null}
      </div>

      {/* Body */}
      <div className="grid min-h-0 flex-1 grid-cols-[240px_1fr] gap-3">
        {/* Left: skills, with the current one expanded into its files */}
        <div className="flex min-h-0 flex-col overflow-hidden rounded-lg border border-border bg-card">
          <div className="shrink-0 border-b border-border p-1.5">
            <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Jump to a skill" aria-label="Filter skills" className="h-7 text-xs" />
          </div>
          <ul className="min-h-0 flex-1 overflow-y-auto p-1">
            {list.map((candidate) => {
              const active = candidate.name === skill.name;
              return (
                <li key={candidate.name}>
                  <button
                    type="button"
                    onClick={() => pick(candidate.name)}
                    aria-current={active ? "true" : undefined}
                    className={cn(
                      "flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs",
                      active ? "bg-state-active text-foreground" : "text-muted-foreground hover:bg-state-hover hover:text-foreground",
                    )}
                  >
                    <SkillLogo skill={candidate} className="size-4 text-[9px]" />
                    <span className="min-w-0 flex-1 truncate">{candidate.name}</span>
                  </button>
                  {active ? (
                    <ul className="mb-1 ml-3 border-l border-border-hairline pl-2">
                      {files === null ? (
                        <li className="px-2 py-1 text-[11px] text-subtle-foreground">Loading…</li>
                      ) : (
                        files.map((file) => (
                          <li key={file.path}>
                            <button
                              type="button"
                              onClick={() => setSelected(file.path)}
                              aria-pressed={selected === file.path}
                              title={file.path}
                              className={cn(
                                "flex w-full items-center gap-1.5 rounded px-1.5 py-1 text-left text-[11px]",
                                selected === file.path ? "text-foreground" : "text-muted-foreground hover:text-foreground",
                              )}
                            >
                              <Icon name={/\.md$/i.test(file.path) ? "FileText" : "File"} className="size-3 shrink-0" />
                              <span className="min-w-0 flex-1 truncate font-mono">{file.path}</span>
                              <span className="shrink-0 tabular-nums text-subtle-foreground">{formatBytes(file.sizeBytes)}</span>
                            </button>
                          </li>
                        ))
                      )}
                    </ul>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </div>

        {/* Right: the file */}
        <div ref={contentRef} className="min-h-0 overflow-y-auto rounded-lg border border-border bg-card p-5">
          {showing === null ? (
            <p className="text-xs text-muted-foreground">Loading…</p>
          ) : showing.binary ? (
            <p className="text-xs text-muted-foreground">Binary file, not shown.</p>
          ) : isMarkdown ? (
            <Markdown content={showing.content} />
          ) : (
            <SourceCode content={showing.content} path={showing.path} overflow="wrap" />
          )}
          {showing?.truncated ? <p className="mt-3 text-xs text-muted-foreground">File truncated at 512 KB.</p> : null}
        </div>
      </div>
    </div>
  );
}
