// Label-picker pattern: one small trigger opens a searchable list of every
// tag in use. Click a row to toggle it on the skill; type a new name and
// press Enter to create it. Changes apply immediately.
import { useMemo, useState, type KeyboardEvent, type ReactNode } from "react";
import { Icon } from "@/components/ui/icon";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import type { Mutations } from "../hooks/use-mutations";

const TAG = /^[a-z0-9][a-z0-9._-]{0,31}$/;

function normalize(raw: string): string {
  return raw.trim().toLowerCase().replace(/\s+/g, "-");
}

export function TagPicker({
  skill,
  tags,
  allTags,
  mutations,
  children,
}: {
  skill: string;
  tags: string[];
  allTags: Array<{ tag: string; count: number }>;
  mutations: Mutations;
  /** The trigger element. */
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState(0);

  const needle = normalize(query);
  const rows = useMemo(() => {
    const known = allTags.map((entry) => entry.tag);
    const merged = [...new Set([...tags, ...known])].sort();
    return needle === "" ? merged : merged.filter((tag) => tag.includes(needle));
  }, [allTags, tags, needle]);
  const canCreate = needle !== "" && TAG.test(needle) && !rows.includes(needle);
  const options = canCreate ? [...rows, needle] : rows;

  const toggle = (tag: string) => {
    const next = tags.includes(tag) ? tags.filter((t) => t !== tag) : [...tags, tag];
    void mutations.setTags(skill, next);
    setQuery("");
    setCursor(0);
  };

  const onKey = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setCursor((value) => Math.min(value + 1, options.length - 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setCursor((value) => Math.max(value - 1, 0));
    } else if (event.key === "Enter") {
      event.preventDefault();
      const pick = options[cursor];
      if (pick !== undefined) toggle(pick);
    } else if (event.key === "Escape") {
      setOpen(false);
    }
  };

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) {
          setQuery("");
          setCursor(0);
        }
      }}
    >
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent className="w-60 p-0" onClick={(event) => event.stopPropagation()} onKeyDown={(event) => event.stopPropagation()}>
        <div className="flex items-center gap-2 border-b border-border px-2.5">
          <Icon name="Search" className="size-3.5 shrink-0 text-subtle-foreground" />
          <input
            autoFocus
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setCursor(0);
            }}
            onKeyDown={onKey}
            placeholder={allTags.length === 0 ? "Name a tag" : "Search or create"}
            aria-label="Search tags"
            className="h-8 w-full bg-transparent text-sm outline-none placeholder:text-subtle-foreground"
          />
        </div>
        <ul role="listbox" className="max-h-56 overflow-auto p-1">
          {options.length === 0 ? (
            <li className="px-2 py-2 text-xs text-subtle-foreground">Type a name to create a tag</li>
          ) : (
            options.map((tag, index) => {
              const on = tags.includes(tag);
              const creating = canCreate && index === options.length - 1;
              return (
                <li key={tag} role="option" aria-selected={on}>
                  <button
                    type="button"
                    onMouseEnter={() => setCursor(index)}
                    onClick={() => toggle(tag)}
                    disabled={mutations.busy}
                    className={cn(
                      "flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm",
                      cursor === index ? "bg-state-hover" : "",
                    )}
                  >
                    <span className={cn("flex size-4 shrink-0 items-center justify-center rounded border", on ? "border-primary bg-primary text-primary-foreground" : "border-input")}>
                      {on ? <Icon name="Check" className="size-3" /> : null}
                    </span>
                    {creating ? (
                      <span className="truncate">
                        <span className="text-muted-foreground">Create </span>
                        {tag}
                      </span>
                    ) : (
                      <span className="truncate">{tag}</span>
                    )}
                  </button>
                </li>
              );
            })
          )}
        </ul>
      </PopoverContent>
    </Popover>
  );
}
