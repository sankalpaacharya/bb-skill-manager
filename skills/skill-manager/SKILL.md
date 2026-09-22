---
name: skill-manager
description: Manage agent skills across Claude Code, Codex, Pi, OpenCode, Gemini and other agents with the `bb skill-manager` CLI. Use when the user asks to install a skill, find a skill on skills.sh, check or apply skill updates, see which agents have which skills, install into or remove from agents, or asks why two agents have different versions of a skill.
---

# Skill Manager

One **hub** directory (default `~/.agents/skills`) holds the canonical copy of
every skill. `skills-lock.json` beside it records where each skill came from,
in the same format the `npx skills` CLI uses. Each agent reads skills from its
own directory and gets a symlink (default) or a copy of the hub version. The
Skills page in the BB sidebar and `bb skill-manager` operate on the same files.

## Commands

| Command | Effect |
| --- | --- |
| `bb skill-manager status` | Matrix of every skill × every agent, with each skill's source and update state. |
| `bb skill-manager show <skill>` | One skill: source, hub hash, and path, state, and hash per agent. |
| `bb skill-manager search [query]` | Search skills.sh. Empty query lists trending. Prints registry ids. |
| `bb skill-manager preview <registry-id>` | Print a registry skill's SKILL.md before installing. |
| `bb skill-manager install <source> [--to a,b] [--all-agents]` | Fetch into the hub, record the source, link the listed agents. |
| `bb skill-manager list-source <source>` | Show the skills a repo offers without installing. |
| `bb skill-manager source <skill> <source>` | Record the origin of a hub skill that has none. |
| `bb skill-manager check [skill...]` | Compare tracked skills with upstream. |
| `bb skill-manager update [skill...] [--force]` | Fetch newer versions into the hub. Linked agents see them at once. |
| `bb skill-manager sync <skill> [--to a,b] [--copy] [--force]` | Install a hub skill into agents. Defaults to every agent and a symlink. |
| `bb skill-manager remove <skill> --from a,b [--force]` | Remove a skill from agents. |
| `bb skill-manager adopt <skill> --from <agent> [--link]` | Copy an agent's version into the hub. `--link` then replaces the source with a symlink. |
| `bb skill-manager diff <skill> <agent>` | File-level diff between the hub and that agent's copy. |
| `bb skill-manager cat <skill> [file] [--from agent]` | Print a skill's SKILL.md or any file in it. |
| `bb skill-manager files <skill>` | List a skill's files. |
| `bb skill-manager tag <skill> <tag...>` / `untag` | Organize skills with tags (plugin-side, never touches the files). |
| `bb skill-manager tags [tag]` | List tags with counts, or the skills carrying one tag. |
| `bb skill-manager doctor` | Every problem with a ready-to-run fix. |

Add `--json` to any read command when the output drives code.

## Source forms

`owner/repo@skill` · `owner/repo/path/to/skill` · a skills.sh id such as
`vercel-labs/agent-skills/vercel-react-best-practices` · a GitHub or GitLab URL,
optionally with `/tree/<ref>/<path>` · a generic Git URL · a local directory.
`owner/repo` alone installs every skill in the repo; run `list-source` first
and pick one unless the user asked for all of them.

## States

Agent cells: `link` (symlink to hub), `same` (identical copy), `MOD` (copy
differs), `only` (not in hub), `ext` (symlink elsewhere), `BROKEN`, `-`.
Update column: `ok`, `UPDATE` (upstream changed), `edited` (local edits),
`edited+UPDATE` (both), `-` (no source recorded).

## Procedure

1. To install something the user names: `bb skill-manager search <words>`, show
   the top matches with their ids, then `bb skill-manager install <id> --all-agents`
   (or `--to` the agents the user mentioned). Confirm what was installed and
   linked.
2. To install from a repo the user gives: `install owner/repo@skill --all-agents`.
   If the repo has several skills and the user did not say which, run
   `list-source` and ask.
3. To keep things current: `check`, then `update` for the rows marked `UPDATE`.
   For `edited+UPDATE`, run `diff`-style reasoning first: tell the user their
   edits would be discarded, and pass `--force` only when they agree.
4. To give an agent a skill the hub already has: `sync <skill> --to <agent>`.
5. To manage a skill that lives only in one agent: `adopt <skill> --from <agent> --link`,
   then `sync` it to the others. Then record its origin with `source` if known.
6. When a cell is `MOD`, run `diff` and say which side is newer before passing
   `--force` to `sync` (hub wins) or `adopt` (agent wins).
7. End with `doctor` and report anything left.

## Rules

- Operate only through `bb skill-manager`. Do not run `npx skills`, and do not
  create or delete files in agent directories by hand; both bypass the lockfile.
- Never `--force` without saying which content will be discarded.
- The plugin edits the home directory of the machine running the BB server. If
  the user's agents live on another machine, say so instead of syncing.
- `install`, `check`, and `update` run `git clone` on the server machine, so
  they need `git` and network access there.
- Agents pick up skill changes on their next session, not mid-session.
- Hub and agent directories are configurable: `bb plugin config skill-manager`.
