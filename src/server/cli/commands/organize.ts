// Tag commands: tag, untag, tags.
import { fail, ok, table } from "../render";
import type { CommandHandler } from "./types";

export const tag: CommandHandler = async ({ service, args, json }) => {
  const [name, ...tags] = args.positional;
  if (name === undefined || tags.length === 0) return fail("tag needs <skill> <tag...>");
  const result = await service.addTags(name, tags);
  return ok(json, { skill: name, tags: result }, `${name}: ${result.join(", ") || "(no tags)"}`);
};

export const untag: CommandHandler = async ({ service, args, json }) => {
  const [name, ...tags] = args.positional;
  if (name === undefined || tags.length === 0) return fail("untag needs <skill> <tag...>");
  const result = await service.removeTags(name, tags);
  return ok(json, { skill: name, tags: result }, `${name}: ${result.join(", ") || "(no tags)"}`);
};

export const tags: CommandHandler = async ({ service, args, json }) => {
  const filter = args.positional[0];
  if (filter !== undefined) {
    const skills = await service.skillsWithTag(filter);
    return ok(json, { tag: filter, skills }, skills.length === 0 ? `No skills tagged "${filter}".` : skills.join("\n"));
  }
  const summary = await service.tagSummary();
  if (summary.length === 0) return ok(json, summary, "No tags yet. Add one with: bb skill-manager tag <skill> <tag>");
  return ok(json, summary, table(["tag", "skills"], summary.map((entry) => [entry.tag, String(entry.count)])));
};
