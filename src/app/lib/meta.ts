// Display metadata for the states the page shows. Colors are theme tokens so
// the page follows whichever palette is active.
import type { CellState, UpdateState } from "./types";

export interface StateMeta {
  label: string;
  title: string;
  /** CSS color value. */
  tone: string;
}

export const CELL_META: Record<CellState, StateMeta> = {
  linked: { label: "linked", title: "Symlink to the hub", tone: "var(--success)" },
  same: { label: "copy", title: "Identical copy of the hub", tone: "var(--primary)" },
  modified: { label: "modified", title: "Copy differs from the hub", tone: "var(--warning)" },
  unmanaged: { label: "unmanaged", title: "Only here; not in the hub", tone: "var(--pr-merged)" },
  "external-link": { label: "external", title: "Symlink to somewhere else", tone: "var(--attention)" },
  broken: { label: "broken", title: "Dangling link or no SKILL.md", tone: "var(--destructive)" },
  missing: { label: "missing", title: "Not installed", tone: "transparent" },
  hub: { label: "via hub", title: "Reads it from the hub; no link needed", tone: "var(--success)" },
};

export const UPDATE_META: Record<UpdateState, StateMeta> = {
  "up-to-date": { label: "up to date", title: "Matches the source", tone: "var(--success)" },
  "update-available": { label: "update", title: "The source has a newer version", tone: "var(--primary)" },
  modified: { label: "edited", title: "Edited locally; source unchanged", tone: "var(--warning)" },
  "modified-and-update": { label: "edited + update", title: "Edited locally and the source changed", tone: "var(--attention)" },
  untracked: { label: "no source", title: "Origin unknown", tone: "var(--muted-foreground)" },
  error: { label: "check failed", title: "Could not reach the source", tone: "var(--destructive)" },
};

export const CELL_ORDER: CellState[] = ["linked", "hub", "same", "modified", "unmanaged", "external-link", "broken", "missing"];

export function isDrifted(state: CellState): boolean {
  return state === "modified" || state === "external-link" || state === "broken";
}
