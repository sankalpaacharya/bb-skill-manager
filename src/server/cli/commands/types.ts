import type { PluginCliResult } from "@get-bb/plugin-sdk";
import type { ParsedArgs } from "../args";
import type { SkillService } from "../../service";

export interface CommandContext {
  service: SkillService;
  args: ParsedArgs;
  /** `--json` was passed. */
  json: boolean;
  /** `--force` was passed. */
  force: boolean;
}

export type CommandHandler = (context: CommandContext) => Promise<PluginCliResult>;
