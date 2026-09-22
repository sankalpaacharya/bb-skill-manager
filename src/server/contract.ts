// RPC contract shared by the server and the frontend. Zod schemas run at the
// wire boundary; the app imports only the inferred types.
import { defineRpcContract } from "@get-bb/plugin-sdk";
import { z } from "zod";

export const SKILLS_CHANGED = "skills-changed";

const cellStateSchema = z.enum(["missing", "linked", "same", "modified", "unmanaged", "external-link", "broken", "hub"]);
const syncModeSchema = z.enum(["link", "copy"]);
const updateStateSchema = z.enum(["up-to-date", "update-available", "modified", "modified-and-update", "untracked", "error"]);

const cellSchema = z.object({
  state: cellStateSchema,
  path: z.string(),
  target: z.string().optional(),
  hash: z.string().optional(),
});

const lockEntrySchema = z.object({
  source: z.string(),
  sourceType: z.enum(["github", "git", "gitlab", "local"]),
  skillPath: z.string(),
  computedHash: z.string(),
  sourceUrl: z.string().optional(),
  ref: z.string().optional(),
});

const updateCheckSchema = z.object({
  skill: z.string(),
  state: updateStateSchema,
  source: z.string().optional(),
  lockHash: z.string().optional(),
  hubHash: z.string().optional(),
  upstreamHash: z.string().optional(),
  checkedAt: z.number(),
  message: z.string().optional(),
});

const skillRowSchema = z.object({
  name: z.string(),
  description: z.string(),
  inHub: z.boolean(),
  hubPath: z.string().optional(),
  hubHash: z.string().optional(),
  lock: lockEntrySchema.optional(),
  update: updateCheckSchema.optional(),
  /** skills.sh figures for tracked GitHub skills, when the registry knows them. */
  registry: z.object({ id: z.string(), source: z.string(), installs: z.number(), stars: z.number().nullable(), url: z.string() }).optional(),
  /** Tracked skill whose registry lookup finished without a match. */
  registryChecked: z.boolean().optional(),
  /** Repo stars when the skill itself is not on skills.sh but its repo is known. */
  stars: z.number().optional(),
  tags: z.array(z.string()),
  cells: z.record(z.string(), cellSchema),
});

const agentStatusSchema = z.object({
  id: z.string(),
  label: z.string(),
  dir: z.string(),
  providerId: z.string().optional(),
  readsHub: z.boolean().optional(),
  exists: z.boolean(),
  active: z.boolean(),
});

const statusSchema = z.object({
  hub: z.string(),
  hubExists: z.boolean(),
  lockfile: z.string(),
  defaultMode: syncModeSchema,
  agents: z.array(agentStatusSchema),
  skills: z.array(skillRowSchema),
  /** Every tag in use, with counts. */
  tags: z.array(z.object({ tag: z.string(), count: z.number() })),
});

const opResultSchema = z.object({
  agent: z.string(),
  outcome: z.enum(["done", "skipped", "error"]),
  message: z.string(),
});

const installResultSchema = z.object({
  skill: z.string(),
  outcome: z.enum(["installed", "updated", "skipped", "error"]),
  message: z.string(),
});

const updateResultSchema = z.object({
  skill: z.string(),
  outcome: z.enum(["updated", "skipped", "error"]),
  message: z.string(),
});

const registrySkillSchema = z.object({
  id: z.string(),
  source: z.string(),
  skillId: z.string(),
  name: z.string(),
  installs: z.number(),
  stars: z.number().nullable(),
  summary: z.string().nullable(),
  topic: z.string().nullable(),
  url: z.string(),
});

const skillName = z.string().trim().min(1).max(128);
const agentIds = z.array(z.string().trim().min(1)).min(1).max(64);

export const rpcContract = defineRpcContract({
  status: { input: z.null(), output: statusSchema },
  sync: {
    input: z.object({
      skills: z.array(skillName).min(1).max(256),
      agents: agentIds.optional(),
      mode: syncModeSchema.optional(),
      force: z.boolean().optional(),
    }),
    output: z.object({ results: z.array(opResultSchema.extend({ skill: z.string() })) }),
  },
  remove: {
    input: z.object({ skill: skillName, agents: agentIds, force: z.boolean().optional() }),
    output: z.object({ results: z.array(opResultSchema) }),
  },
  adopt: {
    input: z.object({ skill: skillName, from: z.string().trim().min(1), force: z.boolean().optional() }),
    output: opResultSchema,
  },
  diff: {
    input: z.object({ skill: skillName, agent: z.string().trim().min(1) }),
    output: z.object({
      hubPath: z.string(),
      agentPath: z.string(),
      files: z.array(z.object({ path: z.string(), status: z.enum(["added", "removed", "changed"]), diff: z.string().optional() })),
    }),
  },
  // --- provenance ---------------------------------------------------------
  install: {
    input: z.object({
      source: z.string().trim().min(1).max(512),
      /** Link into these agents after installing; omit for none. */
      agents: z.array(z.string().trim().min(1)).max(64).optional(),
      force: z.boolean().optional(),
    }),
    output: z.object({ results: z.array(installResultSchema) }),
  },
  setSource: {
    input: z.object({ skill: skillName, source: z.string().trim().min(1).max(512) }),
    output: z.object({ lock: lockEntrySchema }),
  },
  checkUpdates: {
    input: z.object({ skills: z.array(skillName).max(256).optional() }),
    output: z.object({ checks: z.array(updateCheckSchema) }),
  },
  update: {
    input: z.object({ skills: z.array(skillName).max(256).optional(), force: z.boolean().optional() }),
    output: z.object({ results: z.array(updateResultSchema) }),
  },
  // --- organize -----------------------------------------------------------
  setTags: {
    input: z.object({ skill: skillName, tags: z.array(z.string().trim().min(1).max(32)).max(32) }),
    output: z.object({ tags: z.array(z.string()) }),
  },
  // --- content ------------------------------------------------------------
  skillFiles: {
    /** Files of the hub copy, or of one agent's copy when `agent` is given. */
    input: z.object({ skill: skillName, agent: z.string().trim().min(1).optional() }),
    output: z.object({
      dir: z.string(),
      files: z.array(z.object({ path: z.string(), sizeBytes: z.number() })),
    }),
  },
  skillFile: {
    input: z.object({ skill: skillName, agent: z.string().trim().min(1).optional(), path: z.string().min(1).max(512) }),
    output: z.object({ path: z.string(), content: z.string(), truncated: z.boolean(), binary: z.boolean() }),
  },
  // --- registry -----------------------------------------------------------
  registrySearch: {
    input: z.object({ query: z.string().max(200).optional(), page: z.number().int().min(1).max(50).optional() }),
    output: z.object({
      skills: z.array(registrySkillSchema),
      hasMore: z.boolean(),
      page: z.number(),
    }),
  },
  registryDetail: {
    input: z.object({ id: z.string().trim().min(1).max(300) }),
    output: z.object({
      files: z.array(z.object({ path: z.string(), contents: z.string() })),
    }),
  },
});

export type StatusResponse = z.infer<typeof statusSchema>;
export type SkillRowResponse = z.infer<typeof skillRowSchema>;
export type AgentStatusResponse = z.infer<typeof agentStatusSchema>;
export type OpResultResponse = z.infer<typeof opResultSchema>;
export type InstallResultResponse = z.infer<typeof installResultSchema>;
export type UpdateCheckResponse = z.infer<typeof updateCheckSchema>;
export type RegistrySkillResponse = z.infer<typeof registrySkillSchema>;
export type CellState = z.infer<typeof cellStateSchema>;
export type UpdateState = z.infer<typeof updateStateSchema>;
export type SyncMode = z.infer<typeof syncModeSchema>;
