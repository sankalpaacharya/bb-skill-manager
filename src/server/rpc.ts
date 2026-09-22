// RPC handlers for the Skills page. Thin: parse nothing, delegate everything.
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { rpcContract } from "./contract";
import type { SkillService } from "./service";

export function registerRpc(bb: BbPluginApi, service: SkillService): void {
  bb.rpc.register(rpcContract, {
    status: () => service.status(),
    sync: async ({ skills, agents, mode, force }) => ({
      results: await service.sync(skills, agents, mode, force ?? false),
    }),
    remove: async ({ skill, agents, force }) => ({
      results: await service.remove(skill, agents, force ?? false),
    }),
    adopt: ({ skill, from, force }) => service.adopt(skill, from, force ?? false),
    diff: ({ skill, agent }) => service.diff(skill, agent),
    install: async ({ source, agents, force }) => {
      const { installed } = await service.install(source, agents, force ?? false);
      return { results: installed };
    },
    setSource: async ({ skill, source }) => ({ lock: await service.setSource(skill, source) }),
    checkUpdates: async ({ skills }) => ({ checks: await service.checkUpdates(skills) }),
    update: async ({ skills, force }) => ({ results: await service.update(skills, force ?? false) }),
    setTags: async ({ skill, tags }) => ({ tags: await service.setTags(skill, tags) }),
    skillFiles: ({ skill, agent }) => service.skillFiles(skill, agent),
    skillFile: ({ skill, agent, path }) => service.skillFile(skill, agent, path),
    registrySearch: ({ query, page }) => service.registrySearch(query, page),
    registryDetail: ({ id }) => service.registryDetail(id),
  });
}
