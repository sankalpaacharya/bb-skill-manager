// Parse the many ways a user or agent names a skill source into one shape.
//
// Accepted forms:
//   owner/repo                    every skill in the repo (caller picks)
//   owner/repo@skill              skill selected by name
//   owner/repo/path/to/skill      skill selected by path (also the skills.sh id form)
//   https://github.com/o/r[/tree/ref/path]
//   https://gitlab.com/o/r[/-/tree/ref/path]
//   git@host:o/r.git, https://host/o/r.git   generic git
//   ./dir, /abs/dir, ~/dir        local directory
import { expandHome } from "./paths";
import type { SourceType } from "./lockfile";

export type SkillSelector =
  | { kind: "any" }
  | { kind: "name"; name: string }
  | { kind: "path"; path: string };

export interface SourceSpec {
  sourceType: SourceType;
  /** Lockfile `source` value. */
  source: string;
  /** Clone URL for git-backed sources; absolute directory for local. */
  url: string;
  ref?: string;
  selector: SkillSelector;
}

const OWNER_REPO = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const NAME = /^[a-z0-9][a-z0-9-]*$/;

function stripGitSuffix(value: string): string {
  return value.replace(/\.git$/, "");
}

function selectorForPath(rest: string): SkillSelector {
  const trimmed = rest.replace(/^\/+|\/+$/g, "");
  if (trimmed === "") return { kind: "any" };
  return { kind: "path", path: trimmed };
}

/** Split `owner/repo[@skill|/path]` into parts. */
function parseShorthand(input: string, sourceType: "github" | "gitlab"): SourceSpec | null {
  const host = sourceType === "github" ? "github.com" : "gitlab.com";
  let ref: string | undefined;
  let text = input;
  const hash = text.indexOf("#");
  if (hash !== -1) {
    ref = text.slice(hash + 1);
    text = text.slice(0, hash);
  }
  const at = text.indexOf("@");
  let selector: SkillSelector = { kind: "any" };
  if (at !== -1) {
    const name = text.slice(at + 1);
    text = text.slice(0, at);
    if (!NAME.test(name)) return null;
    selector = { kind: "name", name };
  }
  const segments = text.split("/");
  if (segments.length < 2) return null;
  const ownerRepo = `${segments[0]}/${stripGitSuffix(segments[1])}`;
  if (!OWNER_REPO.test(ownerRepo)) return null;
  if (segments.length > 2) {
    if (selector.kind !== "any") return null;
    selector = selectorForPath(segments.slice(2).join("/"));
  }
  return {
    sourceType,
    source: ownerRepo,
    url: `https://${host}/${ownerRepo}.git`,
    ...(ref !== undefined ? { ref } : {}),
    selector,
  };
}

function parseHostedUrl(url: URL): SourceSpec | null {
  const host = url.hostname.toLowerCase();
  const sourceType: "github" | "gitlab" | null =
    host === "github.com" || host === "www.github.com"
      ? "github"
      : host === "gitlab.com" || host === "www.gitlab.com"
        ? "gitlab"
        : null;
  if (sourceType === null) return null;
  const segments = url.pathname.split("/").filter((segment) => segment !== "");
  if (segments.length < 2) return null;
  const ownerRepo = `${segments[0]}/${stripGitSuffix(segments[1])}`;
  if (!OWNER_REPO.test(ownerRepo)) return null;
  let ref: string | undefined;
  let selector: SkillSelector = { kind: "any" };
  // github.com/o/r/tree/<ref>/<path>   gitlab.com/o/r/-/tree/<ref>/<path>
  const treeIndex = segments.findIndex((segment, index) => index >= 2 && segment === "tree");
  if (treeIndex !== -1 && segments.length > treeIndex + 1) {
    ref = segments[treeIndex + 1];
    selector = selectorForPath(segments.slice(treeIndex + 2).join("/"));
  }
  return {
    sourceType,
    source: ownerRepo,
    url: `https://${sourceType === "github" ? "github.com" : "gitlab.com"}/${ownerRepo}.git`,
    ...(ref !== undefined ? { ref } : {}),
    selector,
  };
}

export function parseSource(input: string): SourceSpec {
  const text = input.trim();
  if (text === "") throw new Error("source is required");

  if (text.startsWith("./") || text.startsWith("../") || text.startsWith("/") || text.startsWith("~")) {
    // `./dir@skill` selects one skill inside a local directory.
    const at = text.lastIndexOf("@");
    const name = at > 0 ? text.slice(at + 1) : "";
    const dir = expandHome(at > 0 && NAME.test(name) ? text.slice(0, at) : text);
    const selector: SkillSelector = at > 0 && NAME.test(name) ? { kind: "name", name } : { kind: "any" };
    return { sourceType: "local", source: dir, url: dir, selector };
  }

  if (/^[a-z]+:\/\//.test(text)) {
    const url = new URL(text);
    const hosted = parseHostedUrl(url);
    if (hosted !== null) return hosted;
    return { sourceType: "git", source: text, url: text, selector: { kind: "any" } };
  }

  if (/^git@[^:]+:.+/.test(text)) {
    return { sourceType: "git", source: text, url: text, selector: { kind: "any" } };
  }

  if (text.startsWith("gitlab:")) {
    const parsed = parseShorthand(text.slice("gitlab:".length), "gitlab");
    if (parsed !== null) return parsed;
  }
  const parsed = parseShorthand(text.replace(/^github:/, ""), "github");
  if (parsed !== null) return parsed;

  throw new Error(
    `Cannot understand source "${input}". Use owner/repo, owner/repo@skill, owner/repo/path, a Git URL, or a local path.`,
  );
}

/** Rebuild a spec from a lockfile entry so an installed skill can be re-fetched. */
export function specFromLock(entry: {
  source: string;
  sourceType: SourceType;
  skillPath: string;
  sourceUrl?: string;
  ref?: string;
}): SourceSpec {
  const skillDir = entry.skillPath.replace(/\/?SKILL\.md$/, "");
  const selector: SkillSelector = skillDir === "" ? { kind: "any" } : { kind: "path", path: skillDir };
  switch (entry.sourceType) {
    case "github":
      return {
        sourceType: "github",
        source: entry.source,
        url: `https://github.com/${entry.source}.git`,
        ...(entry.ref !== undefined ? { ref: entry.ref } : {}),
        selector,
      };
    case "gitlab":
      return {
        sourceType: "gitlab",
        source: entry.source,
        url: `https://gitlab.com/${entry.source}.git`,
        ...(entry.ref !== undefined ? { ref: entry.ref } : {}),
        selector,
      };
    case "git":
      return {
        sourceType: "git",
        source: entry.source,
        url: entry.sourceUrl ?? entry.source,
        ...(entry.ref !== undefined ? { ref: entry.ref } : {}),
        selector,
      };
    case "local":
      return { sourceType: "local", source: entry.source, url: entry.source, selector };
  }
}
