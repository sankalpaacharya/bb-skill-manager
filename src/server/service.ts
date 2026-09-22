// Operations shared by the RPC handlers and the CLI commands. Each method
// loads a fresh Config, performs one action, and announces the change.
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import {
  adoptSkill,
  checkUpdates,
  errorMessage,
  diffSkill,
  doctor,
  hashSkillDir,
  installFromSource,
  listFiles,
  readFile,
  lockfilePathForHub,
  parseSource,
  removeSkill,
  syncSkill,
  updateSkills,
  upsertLockEntry,
  type DoctorIssue,
  type FileContent,
  type InstallResult,
  type SkillFile,
  type LockEntry,
  type OpResult,
  type SkillDiff,
  type SyncMode,
  type UpdateCheck,
  type UpdateResult,
} from "../core";
import type { RegistrySkillResponse, StatusResponse } from "./contract";
import { Context, type Config, type RegistryMiss, type RegistryStat } from "./context";
import { normalizeTag } from "./tags";

export type SyncOutcome = OpResult & { skill: string };

export class SkillService {
  constructor(
    private readonly bb: BbPluginApi,
    private readonly context: Context,
  ) {}

  load(): Promise<Config> {
    return this.context.load();
  }

  private cached: { generation: number; at: number; payload: StatusResponse } | null = null;
  private inflight: Promise<StatusResponse> | null = null;
  private static readonly STATUS_TTL_MS = 20_000;

  /**
   * The status payload the page and `status --json` share. A scan hashes
   * every skill folder and may consult the registry, so recent results are
   * reused for a few seconds and concurrent callers share one computation.
   * Any mutation bumps the generation, which drops the cache.
   */
  status(): Promise<StatusResponse> {
    const hit = this.cached;
    if (hit !== null && hit.generation === this.context.generation && Date.now() - hit.at < SkillService.STATUS_TTL_MS) {
      return Promise.resolve(hit.payload);
    }
    if (this.inflight !== null) return this.inflight;
    const generation = this.context.generation;
    this.inflight = this.computeStatus()
      .then((payload) => {
        if (this.context.generation === generation) this.cached = { generation, at: Date.now(), payload };
        return payload;
      })
      .finally(() => {
        this.inflight = null;
      });
    return this.inflight;
  }

  private async computeStatus(): Promise<StatusResponse> {
    const t0 = Date.now();
    const config = await this.load();
    const [tagMap, tags, registry] = await Promise.all([this.context.tags.all(), this.context.tags.summary(), this.context.readRegistry()]);
    this.bb.log.debug(`status: scan ${Date.now() - t0}ms`);
    // Registry lookups and source resolution can take seconds; run them after
    // replying and announce when they change something.
    this.enrichInBackground(config);
    return toStatusResponse(config, tagMap, tags, registry);
  }

  private enriching = false;

  /** Fetch registry figures and resolve sources off the request path; announce on change. */
  private enrichInBackground(config: Config): void {
    if (this.enriching) return;
    this.enriching = true;
    void (async () => {
      try {
        const hubRows = config.status.skills.filter((row) => row.inHub);
        const ids = hubRows.map(registryIdFor).filter((id): id is string => id !== null);
        const untracked = hubRows.filter((row) => registryIdFor(row) === null).map((row) => row.name);
        const before = await this.context.readRegistry();
        const t0 = Date.now();
        const registry = await this.context.registry(ids, untracked);
        const changed = JSON.stringify(registry) !== JSON.stringify(before);
        const resolved = await this.autoResolveSources(config, registry);
        const recorded = resolved.some((result) => result.outcome === "recorded");
        this.bb.log.debug(`enrich: registry ${Date.now() - t0}ms, changed=${changed}, recorded=${recorded}`);
        // setSource already announced for each recorded skill; announce once more for figure changes.
        if (changed && !recorded) this.context.announce();
      } catch (cause) {
        this.bb.log.warn(`enrich failed: ${errorMessage(cause)}`);
      } finally {
        this.enriching = false;
      }
    })();
  }

  /**
   * For untracked hub skills that matched a skills.sh entry by name, fetch
   * that entry's SKILL.md and decide whether it is the same skill: the
   * frontmatter name must match and either the description matches or
   * enough body lines are shared (local copies are often older than
   * upstream, so exact equality is too strict). A confident match records
   * the source. Each skill is compared once per day.
   */
  async autoResolveSources(config: Config, byName: Record<string, RegistryStat | RegistryMiss>, force = false): Promise<ResolveResult[]> {
    const results: ResolveResult[] = [];
    for (const row of config.status.skills) {
      if (!row.inHub || row.lock !== undefined || row.hubPath === undefined) continue;
      const stat = byName[`name:${row.name}`];
      if (stat === undefined || "miss" in stat) {
        results.push({ skill: row.name, outcome: "no-match", message: "not on skills.sh under this name" });
        continue;
      }
      if (stat.verified !== undefined && !force) {
        results.push({ skill: row.name, outcome: "skipped", message: `already compared with ${stat.source}: ${stat.verified}` });
        continue;
      }
      try {
        const detail = await this.bb.sdk.skills.registry.detail({ source: stat.source, skillId: row.name });
        const remote = detail.files?.find((file) => file.path === "SKILL.md" || file.path.endsWith("/SKILL.md"))?.contents ?? "";
        const local = readFile(row.hubPath, "SKILL.md").content;
        const verdict = sameSkill(local, remote);
        await this.context.markVerified(row.name, verdict.same ? "same" : "different");
        if (verdict.same) {
          await this.setSource(row.name, stat.id);
          results.push({ skill: row.name, outcome: "recorded", message: `${stat.source} (${verdict.reason})` });
        } else {
          results.push({ skill: row.name, outcome: "different", message: `${stat.source} is a different skill with the same name (${verdict.reason})` });
        }
      } catch (cause) {
        results.push({ skill: row.name, outcome: "error", message: errorMessage(cause) });
      }
    }
    return results;
  }

  /** Explicit entry point for the CLI: match untracked hub skills against skills.sh. */
  async resolveSources(force: boolean): Promise<ResolveResult[]> {
    const config = await this.load();
    const untracked = config.status.skills.filter((row) => row.inHub && row.lock === undefined).map((row) => row.name);
    const byName = await this.context.registry([], untracked);
    const results = await this.autoResolveSources(config, byName, force);
    this.context.announce();
    return results;
  }

  // --- organize -----------------------------------------------------------

  async setTags(skill: string, tags: string[]): Promise<string[]> {
    const result = await this.context.tags.set(skill, tags);
    this.context.announce();
    return result;
  }

  async addTags(skill: string, tags: string[]): Promise<string[]> {
    const result = await this.context.tags.add(skill, tags);
    this.context.announce();
    return result;
  }

  async removeTags(skill: string, tags: string[]): Promise<string[]> {
    const result = await this.context.tags.remove(skill, tags);
    this.context.announce();
    return result;
  }

  tagSummary(): Promise<Array<{ tag: string; count: number }>> {
    return this.context.tags.summary();
  }

  /** Skills carrying a tag. */
  async skillsWithTag(tag: string): Promise<string[]> {
    const wanted = normalizeTag(tag);
    const map = await this.context.tags.all();
    return Object.entries(map)
      .filter(([, tags]) => tags.includes(wanted))
      .map(([skill]) => skill)
      .sort();
  }

  // --- content ------------------------------------------------------------

  /** Directory holding the skill: the hub copy, or one agent's copy. */
  private async skillDir(skill: string, agent: string | undefined): Promise<string> {
    const config = await this.load();
    const row = config.status.skills.find((candidate) => candidate.name === skill);
    if (row === undefined) throw new Error(`No skill named "${skill}"`);
    if (agent !== undefined) {
      const cell = row.cells[agent];
      if (cell === undefined || cell.state === "missing" || cell.state === "hub" || cell.state === "broken") {
        throw new Error(`${agent} has no copy of "${skill}" of its own`);
      }
      return cell.target ?? cell.path;
    }
    if (row.hubPath !== undefined) return row.hubPath;
    // Not in the hub: fall back to the first agent that has it.
    for (const cell of Object.values(row.cells)) {
      if (cell.state !== "missing" && cell.state !== "hub" && cell.state !== "broken") return cell.target ?? cell.path;
    }
    throw new Error(`"${skill}" has no readable copy`);
  }

  async skillFiles(skill: string, agent: string | undefined): Promise<{ dir: string; files: SkillFile[] }> {
    const dir = await this.skillDir(skill, agent);
    return { dir, files: listFiles(dir) };
  }

  async skillFile(skill: string, agent: string | undefined, relative: string): Promise<FileContent> {
    return readFile(await this.skillDir(skill, agent), relative);
  }

  async sync(skills: string[], agents: string[] | undefined, mode: SyncMode | undefined, force: boolean): Promise<SyncOutcome[]> {
    const config = await this.load();
    const targets = agents ?? config.status.agents.map((agent) => agent.id);
    const results = skills.flatMap((skill) =>
      syncSkill({ status: config.status, skill, agentIds: targets, mode: mode ?? config.defaultMode, force }).map(
        (result) => ({ skill, ...result }),
      ),
    );
    this.context.announce();
    return results;
  }

  async remove(skill: string, agents: string[], force: boolean): Promise<OpResult[]> {
    const config = await this.load();
    const results = removeSkill({ status: config.status, skill, agentIds: agents, force });
    this.context.announce();
    return results;
  }

  async adopt(skill: string, from: string, force: boolean): Promise<OpResult> {
    const config = await this.load();
    const result = adoptSkill({ status: config.status, skill, fromAgent: from, force });
    this.context.announce();
    return result;
  }

  async diff(skill: string, agent: string): Promise<SkillDiff> {
    const config = await this.load();
    return diffSkill({ status: config.status, skill, agent });
  }

  async doctor(): Promise<DoctorIssue[]> {
    return doctor((await this.load()).status);
  }

  /** Install from a source into the hub, then optionally link into agents. */
  async install(source: string, agents: string[] | undefined, force: boolean): Promise<{ installed: InstallResult[]; linked: SyncOutcome[] }> {
    const config = await this.load();
    const installed = await installFromSource({ hub: config.hub, source, force });
    const fresh = installed.filter((result) => result.outcome === "installed" || result.outcome === "updated").map((result) => result.skill);
    for (const skill of fresh) await this.context.forgetUpdate(skill);
    let linked: SyncOutcome[] = [];
    if (agents !== undefined && agents.length > 0 && fresh.length > 0) {
      linked = await this.sync(fresh, agents, undefined, force);
    } else {
      this.context.announce();
    }
    return { installed, linked };
  }

  /** Record (or correct) where a hub skill came from without refetching it. */
  async setSource(skill: string, source: string): Promise<LockEntry> {
    const config = await this.load();
    const row = config.status.skills.find((candidate) => candidate.name === skill);
    if (row === undefined || !row.inHub || row.hubPath === undefined) {
      throw new Error(`"${skill}" is not in the hub`);
    }
    const spec = parseSource(source);
    const skillPath =
      spec.selector.kind === "path"
        ? `${spec.selector.path.replace(/\/?SKILL\.md$/, "")}/SKILL.md`
        : spec.selector.kind === "name"
          ? `${spec.selector.name}/SKILL.md`
          : "SKILL.md";
    const entry: LockEntry = {
      source: spec.source,
      sourceType: spec.sourceType,
      skillPath,
      computedHash: hashSkillDir(row.hubPath),
      ...(spec.sourceType === "git" ? { sourceUrl: spec.url } : {}),
      ...(spec.ref !== undefined ? { ref: spec.ref } : {}),
    };
    upsertLockEntry(lockfilePathForHub(config.hub), skill, entry);
    await this.context.forgetUpdate(skill);
    this.context.announce();
    return entry;
  }

  async checkUpdates(skills: string[] | undefined): Promise<UpdateCheck[]> {
    const config = await this.load();
    const checks = await checkUpdates({ hub: config.hub, skills });
    await this.context.rememberUpdates(checks, config.status.skills.filter((row) => row.inHub).map((row) => row.name));
    this.context.announce();
    return checks;
  }

  async update(skills: string[] | undefined, force: boolean): Promise<UpdateResult[]> {
    const config = await this.load();
    const results = await updateSkills({ hub: config.hub, skills, force });
    for (const result of results) if (result.outcome === "updated") await this.context.forgetUpdate(result.skill);
    this.context.announce();
    return results;
  }

  async registrySearch(query: string | undefined, page: number | undefined): Promise<{ skills: RegistrySkillResponse[]; hasMore: boolean; page: number }> {
    const result = await this.bb.sdk.skills.registry.search({ query, page, perPage: 20 });
    return {
      skills: result.skills.map((skill) => ({
        id: skill.id,
        source: skill.source,
        skillId: skill.skillId,
        name: skill.name,
        installs: skill.installs,
        stars: skill.stars,
        summary: skill.summary,
        topic: skill.topic,
        url: skill.url,
      })),
      hasMore: result.pagination.hasMore,
      page: result.pagination.page,
    };
  }

  async registryDetail(id: string): Promise<{ files: Array<{ path: string; contents: string }> }> {
    const skill = await this.bb.sdk.skills.registry.get({ registrySkillId: id });
    const detail = await this.bb.sdk.skills.registry.detail({ source: skill.source, skillId: skill.skillId });
    return { files: detail.files ?? [] };
  }
}

export interface ResolveResult {
  skill: string;
  outcome: "recorded" | "different" | "no-match" | "skipped" | "error";
  message: string;
}

function frontmatterField(text: string, key: string): string {
  const block = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text)?.[1] ?? "";
  return (new RegExp(`^${key}:\\s*(.*)$`, "m").exec(block)?.[1] ?? "").trim();
}

/** Is `remote` the same skill as `local`, allowing for version drift? */
export function sameSkill(local: string, remote: string): { same: boolean; reason: string } {
  const nameL = frontmatterField(local, "name");
  const nameR = frontmatterField(remote, "name");
  if (nameL === "" || nameL !== nameR) return { same: false, reason: "frontmatter name differs" };
  const descL = frontmatterField(local, "description").slice(0, 80);
  const descR = frontmatterField(remote, "description").slice(0, 80);
  if (descL !== "" && descL === descR) return { same: true, reason: "same description" };
  const lines = (text: string) => new Set(text.split(/\r?\n/).map((line) => line.trim()).filter((line) => line.length > 20));
  const a = lines(local);
  const b = lines(remote);
  let shared = 0;
  for (const line of a) if (b.has(line)) shared++;
  const overlap = shared / Math.max(1, a.size + b.size - shared);
  if (overlap >= 0.3) return { same: true, reason: `${Math.round(overlap * 100)}% of lines shared` };
  return { same: false, reason: `only ${Math.round(overlap * 100)}% of lines shared` };
}

/** skills.sh id for a tracked GitHub skill: `owner/repo/<skill>`; null when unknown. */
export function registryIdFor(row: Config["status"]["skills"][number]): string | null {
  const lock = row.lock;
  if (lock === undefined || lock.sourceType !== "github") return null;
  return `${lock.source}/${row.name}`;
}

/** Shape a Config into the wire payload, attaching cached update checks, tags, and registry figures. */
export function toStatusResponse(
  config: Config,
  tagMap: Record<string, string[]>,
  tags: Array<{ tag: string; count: number }>,
  registry: Record<string, RegistryStat | RegistryMiss> = {},
): StatusResponse {
  return {
    hub: config.status.hub,
    hubExists: config.status.hubExists,
    lockfile: config.status.lockfile,
    defaultMode: config.defaultMode,
    agents: config.status.agents,
    skills: config.status.skills.map((row) => {
      const update = config.updates[row.name];
      // Strict JSON on the wire: never emit an undefined-valued key.
      const id = registryIdFor(row);
      const stat = id !== null ? registry[id] : registry[`name:${row.name}`];
      return {
        ...row,
        ...(update !== undefined ? { update } : {}),
        ...(stat !== undefined && !("miss" in stat)
          ? { registry: { id: stat.id, source: stat.source, installs: stat.installs, stars: stat.stars, url: stat.url } }
          : {}),
        tags: tagMap[row.name] ?? [],
      };
    }),
    tags,
  };
}
