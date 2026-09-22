// Public surface of the core library: pure filesystem and git logic with no
// BB dependency. The server, CLI, and tests import from here.
export {
  DEFAULT_AGENTS,
  DEFAULT_HUB,
  assertSkillName,
  isValidSkillName,
  parseDisabledAgents,
  parseExtraAgents,
  resolveAgents,
  type AgentTarget,
} from "./agents";
export { MAX_FILE_BYTES, listFiles, readFile, type FileContent, type SkillFile } from "./content";
export { diffSkill, lineDiff, type FileDiff, type SkillDiff } from "./diff";
export { doctor, type DoctorIssue, type IssueKind } from "./doctor";
export { Fetcher, discoverSkills, selectSkills, type DiscoveredSkill } from "./fetch";
export { parseFrontmatter, readFrontmatter, type Frontmatter } from "./frontmatter";
export { hashSkillDir, listSkillFiles, shortHash } from "./hash";
export { installFromSource, listSource, lockEntryFor, type InstallResult } from "./install";
export {
  LOCKFILE_NAME,
  describeSource,
  lockfilePathForHub,
  readLockfile,
  removeLockEntry,
  upsertLockEntry,
  writeLockfile,
  type LockEntry,
  type Lockfile,
  type SourceType,
} from "./lockfile";
export { adoptSkill, removeSkill, syncSkill, type OpResult, type SyncMode } from "./operations";
export { contractHome, errorMessage, expandHome } from "./paths";
export { scanStatus, type AgentStatus, type Cell, type CellState, type SkillRow, type Status } from "./scan";
export { parseSource, specFromLock, type SkillSelector, type SourceSpec } from "./source";
export { checkUpdates, updateSkills, type UpdateCheck, type UpdateResult, type UpdateState } from "./updates";
