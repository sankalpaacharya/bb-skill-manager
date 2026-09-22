// Everything a handler needs: settings resolved to concrete values, a fresh
// filesystem scan, and cached update checks merged into the rows.
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";
import {
  DEFAULT_HUB,
  expandHome,
  parseDisabledAgents,
  parseExtraAgents,
  resolveAgents,
  scanStatus,
  type Status,
  type SyncMode,
  type UpdateCheck,
} from "../core";
import { SKILLS_CHANGED } from "./contract";
import { TagStore } from "./tags";

const UPDATE_CACHE_KEY = "update-checks";
const REGISTRY_CACHE_KEY = "registry-stats";
const REGISTRY_TTL_MS = 24 * 60 * 60 * 1000;

/** A lookup that found nothing; kept with a timestamp so it is not retried until the TTL passes. */
export interface RegistryMiss {
  miss: true;
  fetchedAt: number;
}

/** Star count for one repo, cached under `stars:<source>`. */
export interface StarStat {
  stars: number;
  fetchedAt: number;
}

export interface RegistryStat {
  id: string;
  source: string;
  /** Set once we compared the registry SKILL.md with ours: "same" recorded the source automatically. */
  verified?: "same" | "different";
  installs: number;
  stars: number | null;
  url: string;
  fetchedAt: number;
}

export interface Config {
  hub: string;
  defaultMode: SyncMode;
  status: Status;
  /** Last update check per skill, from plugin storage. */
  updates: Record<string, UpdateCheck>;
}

export function defineSettings(bb: BbPluginApi) {
  return bb.settings.define({
    hubDir: {
      type: "string",
      label: "Hub directory",
      default: DEFAULT_HUB,
      experimental_schema: z.string().trim().min(1, "Hub directory is required"),
    },
    defaultMode: {
      type: "select",
      label: "Default install mode",
      options: ["link", "copy"],
      default: "link",
    },
    disabledAgents: {
      type: "string",
      label: "Disabled agents (comma-separated ids)",
      default: "",
    },
    extraAgents: {
      type: "string",
      label: "Extra agents (JSON array of { id, label, dir, providerId? })",
      experimental_multiline: true,
      default: "[]",
      experimental_schema: z.string().refine((value) => {
        try {
          parseExtraAgents(value);
          return true;
        } catch {
          return false;
        }
      }, "Must be a JSON array of { id, label, dir }"),
    },
  });
}

export type Settings = ReturnType<typeof defineSettings>;

export class Context {
  readonly tags: TagStore;

  constructor(
    private readonly bb: BbPluginApi,
    private readonly settings: Settings,
  ) {
    this.tags = new TagStore(bb);
  }

  /** Re-read settings and rescan the filesystem. Every handler starts here. */
  async load(): Promise<Config> {
    const values = await this.settings.get();
    const hub = expandHome(values.hubDir);
    const agents = resolveAgents({
      hub,
      extraAgents: parseExtraAgents(values.extraAgents),
      disabled: parseDisabledAgents(values.disabledAgents),
    });
    return {
      hub,
      defaultMode: values.defaultMode === "copy" ? "copy" : "link",
      status: scanStatus({ hub, agents }),
      updates: await this.readUpdates(),
    };
  }

  /** Tell every open page that the filesystem changed. */
  /** Bump this whenever the filesystem or plugin state changed; cached payloads keyed on it expire. */
  generation = 0;

  announce(): void {
    this.generation++;
    this.bb.realtime.publish(SKILLS_CHANGED, { at: Date.now() });
  }

  async readUpdates(): Promise<Record<string, UpdateCheck>> {
    return (await this.bb.storage.kv.get<Record<string, UpdateCheck>>(UPDATE_CACHE_KEY)) ?? {};
  }

  /** Merge fresh checks into the cache; drop entries for skills no longer in the hub. */
  async rememberUpdates(checks: UpdateCheck[], hubSkills: string[]): Promise<void> {
    const keep = new Set(hubSkills);
    const current = await this.readUpdates();
    for (const check of checks) current[check.skill] = check;
    for (const name of Object.keys(current)) if (!keep.has(name)) delete current[name];
    await this.bb.storage.kv.set(UPDATE_CACHE_KEY, current);
  }

  async readRegistry(): Promise<Record<string, RegistryStat | RegistryMiss | StarStat>> {
    const raw = (await this.bb.storage.kv.get<Record<string, RegistryStat | RegistryMiss | StarStat | null>>(REGISTRY_CACHE_KEY)) ?? {};
    // Older builds stored misses as null; treat those as stale.
    const cache: Record<string, RegistryStat | RegistryMiss | StarStat> = {};
    for (const [key, value] of Object.entries(raw)) if (value !== null) cache[key] = value;
    return cache;
  }

  private isFresh(entry: RegistryStat | RegistryMiss | StarStat | undefined, now: number): boolean {
    return entry !== undefined && now - entry.fetchedAt < REGISTRY_TTL_MS;
  }

  /**
   * Fill `cache` with skills.sh figures for the given registry ids, fetching
   * the ones that are missing or stale. Unknown ids are recorded as misses so
   * they are not looked up again until the TTL passes. Failures are swallowed:
   * the page must never depend on the registry being reachable.
   */
  private async fillRegistryStats(cache: Record<string, RegistryStat | RegistryMiss | StarStat>, ids: string[]): Promise<void> {
    const now = Date.now();
    const stale = ids.filter((id) => !this.isFresh(cache[id], now));
    if (stale.length === 0) return;
    this.bb.log.debug(`registry: fetching ${stale.length} id(s)`);
    for (let index = 0; index < stale.length; index += 50) {
      const chunk = stale.slice(index, index + 50);
      try {
        const { entries } = await this.bb.sdk.skills.registry.entries({ registrySkillIds: chunk });
        const seen = new Set<string>();
        for (const entry of entries) {
          seen.add(entry.id);
          cache[entry.id] = { id: entry.id, source: entry.source, installs: entry.installs, stars: entry.stars, url: entry.url, fetchedAt: now };
        }
        for (const id of chunk) if (!seen.has(id)) cache[id] = { miss: true, fetchedAt: now };
      } catch (cause) {
        this.bb.log.warn(`registry lookup failed: ${cause instanceof Error ? cause.message : String(cause)}`);
      }
    }
  }

  /**
   * Fill `cache` with the best skills.sh match by name for skills with no
   * recorded source (same skill id, most installs), under `name:<skill>`.
   */
  private async fillRegistryByName(cache: Record<string, RegistryStat | RegistryMiss | StarStat>, names: string[]): Promise<void> {
    const now = Date.now();
    const stale = names.filter((name) => !this.isFresh(cache[`name:${name}`], now));
    if (stale.length === 0) return;
    this.bb.log.debug(`registry: searching ${stale.length} name(s)`);
    const lookup = async (name: string) => {
      try {
        const { skills } = await this.bb.sdk.skills.registry.search({ query: name, perPage: 10 });
        const match = skills.filter((entry) => entry.skillId === name || entry.name === name).sort((a, b) => b.installs - a.installs)[0];
        cache[`name:${name}`] =
          match === undefined
            ? { miss: true, fetchedAt: now }
            : { id: match.id, source: match.source, installs: match.installs, stars: match.stars, url: match.url, fetchedAt: now };
      } catch (cause) {
        this.bb.log.warn(`registry search for ${name} failed: ${cause instanceof Error ? cause.message : String(cause)}`);
      }
    };
    // A few at a time so a big hub does not fire dozens of requests at once.
    for (let index = 0; index < stale.length; index += 4) await Promise.all(stale.slice(index, index + 4).map(lookup));
  }

  /** Fill `cache` with repo star counts under `stars:<source>`, one request per unique source. */
  private async fillStars(cache: Record<string, RegistryStat | RegistryMiss | StarStat>, sources: string[]): Promise<void> {
    const now = Date.now();
    const stale = [...new Set(sources)].filter((source) => !this.isFresh(cache[`stars:${source}`], now));
    if (stale.length === 0) return;
    this.bb.log.debug(`registry: stars for ${stale.length} repo(s)`);
    const lookup = async (source: string) => {
      try {
        const { stars } = await this.bb.sdk.skills.registry.repositoryStars({ source });
        cache[`stars:${source}`] = { stars, fetchedAt: now };
      } catch (cause) {
        this.bb.log.warn(`stars for ${source} failed: ${cause instanceof Error ? cause.message : String(cause)}`);
      }
    };
    for (let index = 0; index < stale.length; index += 4) await Promise.all(stale.slice(index, index + 4).map(lookup));
  }

  /**
   * One read, both lookups, one write: registry figures for tracked ids and
   * name matches for untracked skills. Entries for skills no longer present
   * are dropped so the cache tracks the hub.
   */
  async registry(ids: string[], names: string[]): Promise<Record<string, RegistryStat | RegistryMiss | StarStat>> {
    const cache = await this.readRegistry();
    const before = JSON.stringify(cache);
    await this.fillRegistryStats(cache, ids);
    await this.fillRegistryByName(cache, names);
    // Stars are per repo: every tracked source plus every name match's source.
    const sources = new Set<string>();
    for (const id of ids) {
      const hit = cache[id];
      if (hit !== undefined && "source" in hit) sources.add(hit.source);
      else sources.add(id.split("/").slice(0, 2).join("/"));
    }
    for (const name of names) {
      const hit = cache[`name:${name}`];
      if (hit !== undefined && "source" in hit) sources.add(hit.source);
    }
    await this.fillStars(cache, [...sources]);
    const keep = new Set([...ids, ...names.map((name) => `name:${name}`), ...[...sources].map((source) => `stars:${source}`)]);
    for (const key of Object.keys(cache)) if (!keep.has(key)) delete cache[key];
    if (JSON.stringify(cache) !== before) await this.bb.storage.kv.set(REGISTRY_CACHE_KEY, cache);
    return cache;
  }

  async markVerified(name: string, verified: "same" | "different"): Promise<void> {
    const cache = await this.readRegistry();
    const hit = cache[`name:${name}`];
    if (hit === undefined || !("source" in hit)) return;
    cache[`name:${name}`] = { ...hit, verified };
    await this.bb.storage.kv.set(REGISTRY_CACHE_KEY, cache);
  }

  async forgetUpdate(skill: string): Promise<void> {
    const current = await this.readUpdates();
    if (skill in current) {
      delete current[skill];
      await this.bb.storage.kv.set(UPDATE_CACHE_KEY, current);
    }
  }
}
