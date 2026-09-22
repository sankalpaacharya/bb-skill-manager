// Commands that move skills between the hub and agents: sync, remove, adopt.
import type { OpResult, SyncMode } from "../../../core";
import { idList, stringFlag } from "../args";
import { exitCodeFor, fail, ok, renderOpResults } from "../render";
import type { CommandHandler } from "./types";

export const sync: CommandHandler = async ({ service, args, json, force }) => {
  const all = args.flags.has("--all");
  if (args.flags.has("--copy") && args.flags.has("--link")) return fail("choose --copy or --link, not both");
  const mode: SyncMode | undefined = args.flags.has("--copy") ? "copy" : args.flags.has("--link") ? "link" : undefined;
  let skills = args.positional;
  if (all) {
    const payload = await service.status();
    skills = payload.skills.filter((row) => row.inHub).map((row) => row.name);
  }
  if (skills.length === 0) return fail("sync needs a skill name or --all");
  const results = await service.sync(skills, idList(args.flags, "--to"), mode, force);
  return ok(json, results, renderOpResults(results), exitCodeFor(results));
};

export const remove: CommandHandler = async ({ service, args, json, force }) => {
  const name = args.positional[0];
  const agents = idList(args.flags, "--from");
  if (name === undefined || agents === undefined) return fail("remove needs <skill> --from <agent,...>");
  const results = await service.remove(name, agents, force);
  return ok(json, results, renderOpResults(results), exitCodeFor(results));
};

export const adopt: CommandHandler = async ({ service, args, json, force }) => {
  const name = args.positional[0];
  const from = stringFlag(args.flags, "--from");
  if (name === undefined || from === undefined) return fail("adopt needs <skill> --from <agent>");
  const results: OpResult[] = [await service.adopt(name, from, force)];
  if (results[0].outcome === "done" && args.flags.has("--link")) {
    results.push(...(await service.sync([name], [from], "link", true)));
  }
  return ok(json, results, renderOpResults(results), exitCodeFor(results));
};
