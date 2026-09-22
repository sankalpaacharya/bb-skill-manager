// skills.sh registry commands: search, preview.
import { stringFlag } from "../args";
import { fail, ok, table } from "../render";
import type { CommandHandler } from "./types";

export const search: CommandHandler = async ({ service, args, json }) => {
  const query = args.positional.join(" ").trim();
  const pageText = stringFlag(args.flags, "--page");
  const page = pageText !== undefined ? Number.parseInt(pageText, 10) : undefined;
  if (page !== undefined && (!Number.isInteger(page) || page < 1)) return fail("--page must be a positive integer");
  const result = await service.registrySearch(query === "" ? undefined : query, page);
  const rows = result.skills.map((skill) => [
    skill.id,
    String(skill.installs),
    skill.stars !== null ? String(skill.stars) : "",
    (skill.summary ?? "").slice(0, 70),
  ]);
  const text = [
    query === "" ? "Trending on skills.sh" : `Results for "${query}"`,
    table(["id (use with install)", "installs", "stars", "summary"], rows),
    result.hasMore ? `More: add --page ${result.page + 1}` : "",
  ]
    .filter((part) => part !== "")
    .join("\n");
  return ok(json, result, text);
};

export const preview: CommandHandler = async ({ service, args, json }) => {
  const id = args.positional[0];
  if (id === undefined) return fail("preview needs a registry id, e.g. vercel-labs/agent-skills/vercel-react-best-practices");
  const detail = await service.registryDetail(id);
  const text = detail.files.map((file) => `=== ${file.path}\n${file.contents}`).join("\n\n");
  return ok(json, detail, text === "" ? "No preview available." : text);
};
