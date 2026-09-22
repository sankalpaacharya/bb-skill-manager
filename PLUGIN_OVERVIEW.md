Skill Manager keeps one canonical copy of every agent skill in a hub directory
(default `~/.agents/skills`) and installs it into Claude Code, Codex, Pi,
OpenCode, Gemini CLI, Cursor, Copilot CLI, or any directory you add.

The **Skills** sidebar page has two tabs. **Installed** shows a card per agent
with its skill count, then every skill with its source and a logo per agent
whose dot tells you whether that agent has a symlink to the hub, an identical
copy, a copy that has drifted, or nothing. Expand a row to link, copy, diff,
adopt, remove, or update. **Find skills** searches skills.sh, previews the
SKILL.md, and installs into the agents you choose. Paste `owner/repo@skill` or
a GitHub URL to install from anywhere.

Sources are recorded in `skills-lock.json`, the same file `npx skills` writes,
so update checks work for skills installed by either tool and local edits are
never overwritten without confirmation.

Agents get the same power through `bb skill-manager`: `search`, `install`,
`check`, `update`, `sync`, `adopt`, `diff`, and `doctor`.
