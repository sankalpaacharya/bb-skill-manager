// The Find skills tab: search skills.sh, preview, install into the hub and
// chosen agents. Also accepts a raw source (owner/repo@skill, URL, path).
import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { AgentLogo, Empty, OwnerAvatar } from "../components/primitives";
import type { Mutations } from "../hooks/use-mutations";
import { describeError, formatCount } from "../lib/format";
import type { Agent, RegistrySkill, Rpc, Status } from "../lib/types";

function looksLikeSource(text: string): boolean {
  return /^(https?:\/\/|git@|\.\/|\/|~)/.test(text) || /^[\w.-]+\/[\w.-]+(@[\w-]+|\/[\w./-]+)?$/.test(text);
}

function AgentPicker({ agents, chosen, onChange }: { agents: Agent[]; chosen: Set<string>; onChange: (next: Set<string>) => void }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="text-xs text-muted-foreground">Install into</span>
      {agents.map((agent) => {
        const on = chosen.has(agent.id);
        return (
          <button
            key={agent.id}
            type="button"
            onClick={() => {
              const next = new Set(chosen);
              if (on) next.delete(agent.id);
              else next.add(agent.id);
              onChange(next);
            }}
            aria-pressed={on}
            title={agent.label}
            className={cn(
              "inline-flex h-7 items-center gap-1.5 rounded-md border px-2 text-xs transition-colors",
              on ? "border-primary/60 bg-surface-selected" : "border-border opacity-50 hover:opacity-80",
            )}
          >
            <AgentLogo agent={agent} className="size-3.5" />
            {agent.label}
          </button>
        );
      })}
    </div>
  );
}

function ResultRow({
  skill,
  installed,
  rpc,
  onInstall,
  busy,
}: {
  skill: RegistrySkill;
  installed: boolean;
  rpc: Rpc;
  onInstall: () => void;
  busy: boolean;
}) {
  const [preview, setPreview] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const togglePreview = async () => {
    if (preview !== null) return setPreview(null);
    setLoading(true);
    try {
      const detail = await rpc.call("registryDetail", { id: skill.id });
      setPreview(detail.files.map((file) => file.contents).join("\n\n") || "No preview available.");
    } catch (cause) {
      toast.error(describeError(cause));
    } finally {
      setLoading(false);
    }
  };
  return (
    <li className="border-b border-border-hairline px-3 py-2.5 last:border-b-0">
      <div className="flex items-start gap-3">
        <OwnerAvatar owner={skill.source.split("/")[0] ?? null} letter={skill.name} className="mt-0.5 size-8" />
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium">{skill.name}</span>
            <span className="font-mono text-[11px] text-subtle-foreground">{skill.source}</span>
            {skill.topic !== null ? <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">{skill.topic}</span> : null}
          </span>
          {skill.summary !== null ? <span className="mt-0.5 block text-xs text-muted-foreground">{skill.summary}</span> : null}
          <span className="mt-1 flex gap-3 text-[11px] text-subtle-foreground">
            <span>{formatCount(skill.installs)} installs</span>
            {skill.stars !== null ? (
              <span>
                <Icon name="Star" className="mr-0.5 inline size-3 align-[-2px]" style={{ color: "var(--warning)" }} />
                {formatCount(skill.stars)}
              </span>
            ) : null}
            <a href={skill.url} target="_blank" rel="noreferrer" className="hover:text-foreground">
              skills.sh
            </a>
          </span>
        </span>
        <span className="flex shrink-0 gap-1.5">
          <Button size="sm" variant="outline" className="h-7 px-2.5 text-xs" disabled={loading} onClick={() => void togglePreview()}>
            {preview === null ? "Preview" : "Hide"}
          </Button>
          <Button size="sm" className="h-7 px-2.5 text-xs" disabled={busy || installed} onClick={onInstall}>
            {installed ? "Installed" : "Install"}
          </Button>
        </span>
      </div>
      {preview !== null ? (
        <pre className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap rounded-md border border-border bg-surface-recessed p-3 font-mono text-xs">{preview}</pre>
      ) : null}
    </li>
  );
}

export function FindPage({ status, rpc, mutations }: { status: Status; rpc: Rpc; mutations: Mutations }) {
  const [query, setQuery] = useState("");
  const [submitted, setSubmitted] = useState("");
  const [page, setPage] = useState(1);
  const [results, setResults] = useState<RegistrySkill[] | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [searching, setSearching] = useState(false);
  const [chosen, setChosen] = useState<Set<string>>(() => new Set(status.agents.filter((a) => a.active).map((a) => a.id)));
  const [grouped, setGrouped] = useState(false);
  const [open, setOpen] = useState<Set<string>>(() => new Set());
  const toggleGroup = (source: string) =>
    setOpen((current) => {
      const next = new Set(current);
      if (next.has(source)) next.delete(source);
      else next.add(source);
      return next;
    });

  /** Results grouped by repo, in order of first appearance so ranking is preserved. */
  const groups = useMemo(() => {
    if (results === null) return [];
    const map = new Map<string, RegistrySkill[]>();
    for (const skill of results) {
      const list = map.get(skill.source);
      if (list === undefined) map.set(skill.source, [skill]);
      else list.push(skill);
    }
    return [...map.entries()].map(([source, skills]) => ({ source, owner: source.split("/")[0] ?? null, skills }));
  }, [results]);

  const agents = status.agents.filter((agent) => agent.active);
  const hubNames = new Set(status.skills.filter((skill) => skill.inHub).map((skill) => skill.name));

  const search = useCallback(
    async (text: string, nextPage: number) => {
      setSearching(true);
      try {
        // RPC inputs are strict JSON: omit the key rather than send undefined.
        const result = await rpc.call("registrySearch", { ...(text === "" ? {} : { query: text }), page: nextPage });
        setResults((current) => (nextPage === 1 || current === null ? result.skills : [...current, ...result.skills]));
        setHasMore(result.hasMore);
        setPage(result.page);
      } catch (cause) {
        toast.error(describeError(cause));
      } finally {
        setSearching(false);
      }
    },
    [rpc],
  );

  useEffect(() => {
    void search("", 1);
  }, [search]);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const text = query.trim();
    setSubmitted(text);
    void search(text, 1);
  };

  const installSource = (source: string) => void mutations.install(source, [...chosen]);
  const directSource = query.trim();

  return (
    <>
      <form onSubmit={submit} className="flex flex-wrap items-center gap-2">
        <Input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search skills.sh, or paste owner/repo@skill, a GitHub URL, or a folder"
          aria-label="Search skills"
          className="h-8 max-w-xl"
        />
        <Button type="submit" size="sm" disabled={searching}>
          <Icon name="Search" className="size-4" />
          Search
        </Button>
        {looksLikeSource(directSource) ? (
          <Button type="button" size="sm" variant="outline" disabled={mutations.busy} onClick={() => installSource(directSource)}>
            <Icon name="Download" className="size-4" />
            Install from source
          </Button>
        ) : null}
      </form>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <AgentPicker agents={agents} chosen={chosen} onChange={setChosen} />
        <span className="ml-auto flex rounded-md border border-border p-0.5">
          <Button variant="ghost" size="icon" className={cn("size-7", !grouped && "bg-state-active text-foreground")} aria-label="Flat list" aria-pressed={!grouped} onClick={() => setGrouped(false)}>
            <Icon name="ListView" className="size-4" />
          </Button>
          <Button variant="ghost" size="icon" className={cn("size-7", grouped && "bg-state-active text-foreground")} aria-label="Group by source" aria-pressed={grouped} onClick={() => setGrouped(true)}>
            <Icon name="Layers" className="size-4" />
          </Button>
        </span>
      </div>

      {results === null ? (
        <div className="mt-3 rounded-lg border border-border bg-card">
          <Empty>Loading skills.sh…</Empty>
        </div>
      ) : results.length === 0 ? (
        <div className="mt-3 rounded-lg border border-border bg-card">
          <Empty>No results{submitted !== "" ? ` for "${submitted}"` : ""}.</Empty>
        </div>
      ) : grouped ? (
        <div className="mt-3 space-y-4">
          {groups.map((group) => {
            const expanded = open.has(group.source);
            const installedCount = group.skills.filter((skill) => hubNames.has(skill.name) || hubNames.has(skill.skillId)).length;
            return (
              <section key={group.source}>
                <header className="flex items-center gap-2.5">
                  <button
                    type="button"
                    onClick={() => toggleGroup(group.source)}
                    aria-expanded={expanded}
                    className="flex min-w-0 flex-1 items-center gap-2.5 rounded-md py-1 pr-2 text-left transition-colors hover:bg-state-hover"
                  >
                    <Icon name="ChevronRight" className={cn("size-3.5 shrink-0 text-subtle-foreground transition-transform", expanded && "rotate-90")} />
                    <OwnerAvatar owner={group.owner} letter={group.source} className="size-6" />
                    <span className="truncate text-sm font-medium">{group.source}</span>
                    <span className="text-xs tabular-nums text-muted-foreground">
                      {group.skills.length}
                      {installedCount > 0 ? <span className="opacity-60"> · {installedCount} installed</span> : null}
                    </span>
                  </button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 px-2.5 text-xs"
                    disabled={mutations.busy || installedCount === group.skills.length}
                    onClick={() => installSource(group.source)}
                  >
                    {installedCount === group.skills.length ? "All installed" : "Install all"}
                  </Button>
                </header>
                {expanded ? (
                  <div className="mt-2 overflow-hidden rounded-lg border border-border bg-card">
                    <ul>
                      {group.skills.map((skill) => (
                        <ResultRow
                          key={skill.id}
                          skill={skill}
                          installed={hubNames.has(skill.name) || hubNames.has(skill.skillId)}
                          rpc={rpc}
                          busy={mutations.busy}
                          onInstall={() => installSource(skill.id)}
                        />
                      ))}
                    </ul>
                  </div>
                ) : null}
              </section>
            );
          })}
        </div>
      ) : (
        <div className="mt-3 overflow-hidden rounded-lg border border-border bg-card">
          <ul>
            {results.map((skill) => (
              <ResultRow
                key={skill.id}
                skill={skill}
                installed={hubNames.has(skill.name) || hubNames.has(skill.skillId)}
                rpc={rpc}
                busy={mutations.busy}
                onInstall={() => installSource(skill.id)}
              />
            ))}
          </ul>
        </div>
      )}
      {hasMore ? (
        <div className="mt-2 text-center">
          <Button size="sm" variant="outline" disabled={searching} onClick={() => void search(submitted, page + 1)}>
            Load more
          </Button>
        </div>
      ) : null}
      <p className="mt-3 text-[11px] text-muted-foreground">
        {submitted === "" ? "Showing trending skills." : null} Installing copies the skill into the hub, records its source in the lockfile, and links the chosen agents.
      </p>
    </>
  );
}
