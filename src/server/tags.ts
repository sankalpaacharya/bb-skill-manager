// Tags are plugin state, not filesystem state: they live in the plugin's
// key-value store so the hub and agent folders stay untouched and other
// tools (npx skills, BB's own page) are unaffected.
import type { BbPluginApi } from "@get-bb/plugin-sdk";

const TAGS_KEY = "tags";
const TAG = /^[a-z0-9][a-z0-9._-]{0,31}$/;

export type TagMap = Record<string, string[]>;

export function normalizeTag(raw: string): string {
  const tag = raw.trim().toLowerCase().replace(/\s+/g, "-");
  if (!TAG.test(tag)) throw new Error(`Invalid tag "${raw}": use letters, digits, ".", "_" or "-", up to 32 characters.`);
  return tag;
}

export class TagStore {
  constructor(private readonly bb: BbPluginApi) {}

  async all(): Promise<TagMap> {
    return (await this.bb.storage.kv.get<TagMap>(TAGS_KEY)) ?? {};
  }

  async forSkill(skill: string): Promise<string[]> {
    return (await this.all())[skill] ?? [];
  }

  /** Replace a skill's tags. An empty list removes the entry. */
  async set(skill: string, tags: string[]): Promise<string[]> {
    const normalized = [...new Set(tags.map(normalizeTag))].sort();
    const map = await this.all();
    if (normalized.length === 0) delete map[skill];
    else map[skill] = normalized;
    await this.bb.storage.kv.set(TAGS_KEY, map);
    return normalized;
  }

  async add(skill: string, tags: string[]): Promise<string[]> {
    return this.set(skill, [...(await this.forSkill(skill)), ...tags]);
  }

  async remove(skill: string, tags: string[]): Promise<string[]> {
    const drop = new Set(tags.map(normalizeTag));
    return this.set(skill, (await this.forSkill(skill)).filter((tag) => !drop.has(tag)));
  }

  /** Every tag in use with how many skills carry it. */
  async summary(): Promise<Array<{ tag: string; count: number }>> {
    const counts = new Map<string, number>();
    for (const tags of Object.values(await this.all())) {
      for (const tag of tags) counts.set(tag, (counts.get(tag) ?? 0) + 1);
    }
    return [...counts.entries()].map(([tag, count]) => ({ tag, count })).sort((a, b) => a.tag.localeCompare(b.tag));
  }
}
