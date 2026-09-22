// Commands about where skills come from: install, list-source, source,
// check, update.
import { listSource } from "../../../core";
import { idList } from "../args";
import { exitCodeFor, fail, ok, renderChecks, renderInstallResults, renderOpResults, renderUpdateResults, table } from "../render";
import type { CommandHandler } from "./types";

export const install: CommandHandler = async ({ service, args, json, force }) => {
  const source = args.positional[0];
  if (source === undefined) return fail("install needs a source, e.g. owner/repo@skill");
  let agents = idList(args.flags, "--to");
  if (args.flags.has("--all-agents")) {
    const payload = await service.status();
    agents = payload.agents.filter((agent) => agent.active).map((agent) => agent.id);
  }
  const { installed, linked } = await service.install(source, agents, force);
  const text = [renderInstallResults(installed), linked.length > 0 ? renderOpResults(linked) : ""].filter((part) => part !== "").join("\n");
  return ok(json, { installed, linked }, text, exitCodeFor([...installed, ...linked]));
};

export const listSourceCommand: CommandHandler = async ({ args, json }) => {
  const source = args.positional[0];
  if (source === undefined) return fail("list-source needs a source");
  const skills = await listSource(source);
  const rows = skills.map((skill) => [skill.name, skill.skillPath, skill.description.slice(0, 80)]);
  return ok(json, skills, skills.length === 0 ? "No skills found in that source." : table(["name", "path", "description"], rows));
};

export const source: CommandHandler = async ({ service, args, json }) => {
  const [name, sourceText] = args.positional;
  if (name === undefined || sourceText === undefined) return fail("source needs <skill> <source>");
  const lock = await service.setSource(name, sourceText);
  return ok(json, lock, `${name}: source recorded as ${lock.source} (${lock.skillPath})`);
};

export const check: CommandHandler = async ({ service, args, json }) => {
  const skills = args.positional.length > 0 ? args.positional : undefined;
  const checks = await service.checkUpdates(skills);
  const exitCode = checks.some((entry) => entry.state === "error") ? 1 : 0;
  return ok(json, checks, renderChecks(checks), exitCode);
};

export const update: CommandHandler = async ({ service, args, json, force }) => {
  const skills = args.positional.length > 0 ? args.positional : undefined;
  const results = await service.update(skills, force);
  return ok(json, results, results.length === 0 ? "Nothing to update." : renderUpdateResults(results), exitCodeFor(results));
};

export const resolveSources: CommandHandler = async ({ service, json, force }) => {
  const results = await service.resolveSources(force);
  const text = results.map((result) => `${result.outcome.padEnd(10)} ${result.skill}: ${result.message}`).join("\n");
  return ok(json, results, results.length === 0 ? "Every hub skill already has a source." : text, results.some((r) => r.outcome === "error") ? 1 : 0);
};
