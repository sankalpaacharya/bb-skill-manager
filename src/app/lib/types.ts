// Frontend-side type aliases derived from the server contract.
import type { useRpc } from "@get-bb/plugin-sdk/app";
import type { rpcContract } from "../../server/contract";

export type Rpc = ReturnType<typeof useRpc<typeof rpcContract>>;
export type RpcContract = typeof rpcContract;

export type {
  AgentStatusResponse as Agent,
  CellState,
  InstallResultResponse as InstallResult,
  OpResultResponse as OpResult,
  RegistrySkillResponse as RegistrySkill,
  SkillRowResponse as Skill,
  StatusResponse as Status,
  SyncMode,
  UpdateCheckResponse as UpdateCheck,
  UpdateState,
} from "../../server/contract";

export type DiffResponse = Awaited<ReturnType<Rpc["call"]>> extends infer R ? Extract<R, { files: unknown; hubPath: unknown }> : never;
