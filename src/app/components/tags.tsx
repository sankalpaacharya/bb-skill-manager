// Tag chips and the tag filter row. Assigning tags lives in tag-picker.tsx.
import { Icon } from "@/components/ui/icon";
import { cn } from "@/lib/utils";

export const UNTAGGED = "__untagged__";

export function TagChip({ tag, onRemove, small = false }: { tag: string; onRemove?: () => void; small?: boolean }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full bg-muted leading-none text-muted-foreground",
        small ? "h-4 px-1.5 text-[10px]" : "h-5 px-2 text-[11px]",
      )}
    >
      {tag}
      {onRemove !== undefined ? (
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            onRemove();
          }}
          aria-label={`Remove tag ${tag}`}
          className="-mr-1 rounded-full p-0.5 hover:bg-state-hover hover:text-foreground"
        >
          <Icon name="X" className="size-3" />
        </button>
      ) : null}
    </span>
  );
}

/** Row of tag filters. `selected` is a tag, UNTAGGED, or null for all. */
export function TagFilter({
  tags,
  untaggedCount,
  selected,
  onSelect,
}: {
  tags: Array<{ tag: string; count: number }>;
  untaggedCount: number;
  selected: string | null;
  onSelect: (tag: string | null) => void;
}) {
  if (tags.length === 0) return null;
  const chip = (key: string | null, label: string, count: number) => {
    const active = selected === key;
    return (
      <button
        key={key ?? "all"}
        type="button"
        onClick={() => onSelect(active ? null : key)}
        aria-pressed={active}
        className={cn(
          "inline-flex h-6 items-center gap-1.5 rounded-full border px-2.5 text-[11px] transition-colors",
          active ? "border-primary/60 bg-surface-selected text-foreground" : "border-border text-muted-foreground hover:text-foreground",
        )}
      >
        {label}
        <span className="tabular-nums opacity-60">{count}</span>
      </button>
    );
  };
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <Icon name="Folder" className="size-3.5 text-subtle-foreground" />
      {tags.map((entry) => chip(entry.tag, entry.tag, entry.count))}
      {untaggedCount > 0 ? chip(UNTAGGED, "untagged", untaggedCount) : null}
    </div>
  );
}
