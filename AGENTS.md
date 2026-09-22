# Working in this repo

## Commit messages

Every commit follows Conventional Commits. No exceptions, including agent commits.

```
<type>(<scope>): <description>

[body]

[footer]
```

- `type` is one of: feat, fix, docs, style, refactor, perf, test, build, ci, chore, revert
- `scope` is optional. Use the area touched: core, server, cli, app, installed, find, reader, dashboard, readme, deps
- `description` is imperative, lowercase, no trailing period, under 72 characters. "add", not "added" or "adds"
- Body explains why, not what. Wrap at 72. Only add one when the diff does not explain itself
- Breaking change: add `!` after the type or scope and a `BREAKING CHANGE:` footer
- One logical change per commit. Do not mix a fix with a refactor

Before committing: run `git status` and `git diff --staged`, stage only what belongs to this change, then commit.

Examples:

```
feat(installed): collapse source groups
fix(status): return before registry lookups
docs(readme): add logo and shorten intro
refactor(core): split scan into hash and frontmatter
chore(deps): pin hugeicons to 4.3.0
```

## Verify before you push

```sh
npm test
npm run typecheck
bb plugin build
```

## Layout

- `src/core` pure filesystem and git logic, no BB imports, unit tested
- `src/server` plugin factory, RPC contract, CLI
- `src/app` the Skills page
- `components/ui` vendored BB UI, do not restyle

BB RPC is strict JSON: never send an undefined-valued key. Use conditional spreads.
