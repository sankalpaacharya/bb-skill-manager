// File-level comparison between the hub copy and an agent's copy of a skill.
import * as fs from "node:fs";
import * as path from "node:path";
import { assertSkillName } from "./agents";
import { safeRealpath } from "./paths";
import { listSkillFiles } from "./hash";
import type { Status } from "./scan";

export interface FileDiff {
  path: string;
  status: "added" | "removed" | "changed";
  /** Compact line diff for small text files; absent for binary or large files. */
  diff?: string;
}

export interface SkillDiff {
  hubPath: string;
  agentPath: string;
  files: FileDiff[];
}

const MAX_DIFF_BYTES = 200_000;

/** Compare an agent's entry against the hub copy, file by file. */
export function diffSkill(options: { status: Status; skill: string; agent: string }): SkillDiff {
  const name = assertSkillName(options.skill);
  const row = options.status.skills.find((skill) => skill.name === name);
  if (row === undefined || !row.inHub || row.hubPath === undefined) {
    throw new Error(`"${name}" is not in the hub`);
  }
  const cell = row.cells[options.agent];
  if (cell === undefined || cell.state === "missing" || cell.state === "hub" || cell.state === "broken") {
    throw new Error(`agent "${options.agent}" has no usable "${name}"`);
  }

  const hubPath = safeRealpath(row.hubPath) ?? row.hubPath;
  const agentPath = cell.target ?? cell.path;
  const hubFiles = new Set(listSkillFiles(hubPath));
  const agentFiles = new Set(listSkillFiles(agentPath));

  const files: FileDiff[] = [];
  for (const relative of [...new Set([...hubFiles, ...agentFiles])].sort()) {
    if (!hubFiles.has(relative)) {
      files.push({ path: relative, status: "added" });
      continue;
    }
    if (!agentFiles.has(relative)) {
      files.push({ path: relative, status: "removed" });
      continue;
    }
    const hubBytes = fs.readFileSync(path.join(hubPath, relative));
    const agentBytes = fs.readFileSync(path.join(agentPath, relative));
    if (hubBytes.equals(agentBytes)) continue;

    const entry: FileDiff = { path: relative, status: "changed" };
    const small = hubBytes.length <= MAX_DIFF_BYTES && agentBytes.length <= MAX_DIFF_BYTES;
    if (small && isText(hubBytes) && isText(agentBytes)) {
      entry.diff = lineDiff(hubBytes.toString("utf8"), agentBytes.toString("utf8"));
    }
    files.push(entry);
  }
  return { hubPath, agentPath, files };
}

function isText(buffer: Buffer): boolean {
  return !buffer.subarray(0, 4096).includes(0);
}

type DiffOp = { tag: " " | "-" | "+"; line: string };

/**
 * Minimal LCS line diff. `-` lines come from the hub, `+` lines from the
 * agent; unchanged lines are kept only as context around changes, with `@@`
 * marking elided runs.
 */
export function lineDiff(hubText: string, agentText: string, context = 2): string {
  const a = hubText.split("\n");
  const b = agentText.split("\n");
  const n = a.length;
  const m = b.length;

  // lcs[i][j] = LCS length of a[i..] and b[j..]
  const lcs: Uint32Array[] = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }

  const ops: DiffOp[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) ops.push({ tag: " ", line: a[i++] }), j++;
    else if (lcs[i + 1][j] >= lcs[i][j + 1]) ops.push({ tag: "-", line: a[i++] });
    else ops.push({ tag: "+", line: b[j++] });
  }
  while (i < n) ops.push({ tag: "-", line: a[i++] });
  while (j < m) ops.push({ tag: "+", line: b[j++] });

  const keep = new Array<boolean>(ops.length).fill(false);
  ops.forEach((op, index) => {
    if (op.tag === " ") return;
    const from = Math.max(0, index - context);
    const to = Math.min(ops.length - 1, index + context);
    for (let k = from; k <= to; k++) keep[k] = true;
  });

  const lines: string[] = [];
  let elided = false;
  ops.forEach((op, index) => {
    if (!keep[index]) {
      elided = true;
      return;
    }
    if (elided && lines.length > 0) lines.push("@@");
    elided = false;
    lines.push(`${op.tag} ${op.line}`);
  });
  return lines.join("\n");
}
