// bb-plugin-skill-manager — backend entry.
//
// One hub directory (default ~/.agents/skills) holds the canonical copy of
// every skill, and `skills-lock.json` beside it records where each came
// from. Coding agents get a symlink or copy in their own skills directory.
//
// This file only wires things together:
//   context.ts   settings and cached state
//   service.ts   the operations, built on ../core
//   rpc.ts       handlers for the Skills page
//   cli/         `bb skill-manager …`
//
// File I/O runs on the machine that hosts the BB server and targets its
// home directory; enrolled remote machines are out of scope.
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { registerCli } from "./cli";
import { Context, defineSettings } from "./context";
import { registerRpc } from "./rpc";
import { SkillService } from "./service";

export { rpcContract, SKILLS_CHANGED } from "./contract";
export type * from "./contract";

export default async function plugin(bb: BbPluginApi): Promise<void> {
  const settings = defineSettings(bb);
  const context = new Context(bb, settings);
  const service = new SkillService(bb, context);

  registerRpc(bb, service);
  registerCli(bb, service);

  bb.onDispose(() => {
    bb.log.info("disposed");
  });
}
