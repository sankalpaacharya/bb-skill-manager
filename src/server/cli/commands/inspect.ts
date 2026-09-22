// Read-only commands: status, agents, show, diff, doctor.
import { contractHome, shortHash } from "../../../core";
import { stringFlag } from "../args";
import { fail, ok, renderDiff, renderDoctor, renderStatus, table } from "../render";
import type { CommandHandler } from "./types";

export const status: CommandHandler = async ({ service, json }) => {
  const payload = await service.status();
  return ok(json, payload, renderStatus(payload));
};

export const agents: CommandHandler = async ({ service, json }) => {
  const payload = await service.status();
  const rows = payload.agents.map((agent) => [agent.id, agent.label, contractHome(agent.dir), agent.exists ? "yes" : "no", agent.readsHub === true ? "yes" : ""]);
  return ok(json, payload.agents, table(["id", "label", "dir", "exists", "reads hub"], rows));
};

export const show: CommandHandler = async ({ service, args, json }) => {
  const name = args.positional[0];
  if (name === undefined) return fail("show needs a skill name");
  const payload = await service.status();
  const row = payload.skills.find((skill) => skill.name === name);
  if (row === undefined) return fail(`No skill named "${name}" in the hub or any agent.`);
  const lines = [
    `${row.name}${row.description === "" ? "" : ` — ${row.description}`}`,
    `hub:    ${row.inHub ? `${contractHome(row.hubPath ?? "")} (${shortHash(row.hubHash ?? "")})` : "not in hub"}`,
    `source: ${row.lock !== undefined ? `${row.lock.source} · ${row.lock.skillPath}${row.lock.ref !== undefined ? ` @ ${row.lock.ref}` : ""}` : "unknown"}`,
    `update: ${row.update !== undefined ? `${row.update.state} (checked ${new Date(row.update.checkedAt).toLocaleString()})` : "not checked"}`,
    ...payload.agents.map((agent) => {
      const cell = row.cells[agent.id];
      const extra = cell.target !== undefined ? ` → ${contractHome(cell.target)}` : "";
      const hash = cell.hash !== undefined ? ` (${shortHash(cell.hash)})` : "";
      return `  ${agent.id.padEnd(10)} ${cell.state}${extra}${hash}`;
    }),
  ];
  return ok(json, row, lines.join("\n"));
};

export const diff: CommandHandler = async ({ service, args, json }) => {
  const [name, agent] = args.positional;
  if (name === undefined || agent === undefined) return fail("diff needs <skill> <agent>");
  const result = await service.diff(name, agent);
  return ok(json, result, renderDiff(result, name, agent));
};

export const doctor: CommandHandler = async ({ service, json }) => {
  const issues = await service.doctor();
  return ok(json, issues, renderDoctor(issues));
};

export const files: CommandHandler = async ({ service, args, json }) => {
  const name = args.positional[0];
  if (name === undefined) return fail("files needs a skill name");
  const result = await service.skillFiles(name, stringFlag(args.flags, "--from"));
  const rows = result.files.map((file) => [file.path, String(file.sizeBytes)]);
  return ok(json, result, `${contractHome(result.dir)}\n\n${table(["file", "bytes"], rows)}`);
};

export const cat: CommandHandler = async ({ service, args, json }) => {
  const [name, relative = "SKILL.md"] = args.positional;
  if (name === undefined) return fail("cat needs <skill> [file]");
  const result = await service.skillFile(name, stringFlag(args.flags, "--from"), relative);
  if (result.binary) return fail(`${relative} is a binary file`);
  return ok(json, result, result.truncated ? `${result.content}\n\n[truncated]` : result.content);
};
