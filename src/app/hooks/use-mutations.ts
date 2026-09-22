// Every write the page can perform, wrapped with busy state, a toast summary,
// and a refetch. Components call these and never touch RPC directly.
import { useCallback, useState } from "react";
import { toast } from "sonner";
import { describeError } from "../lib/format";
import type { InstallResult, OpResult, Rpc, SyncMode } from "../lib/types";

interface Outcome {
  outcome: string;
  message: string;
  /** Agent id or skill name, whichever identifies the row. */
  subject: string;
}

function summarize(results: Outcome[]): void {
  const errors = results.filter((r) => r.outcome === "error");
  const done = results.filter((r) => r.outcome === "done" || r.outcome === "installed" || r.outcome === "updated");
  const skipped = results.filter((r) => r.outcome === "skipped");
  if (errors.length > 0) toast.error(errors.map((r) => `${r.subject}: ${r.message}`).join("\n"));
  else if (done.length > 0) toast.success(`${done.length} change${done.length === 1 ? "" : "s"} applied`);
  else if (skipped.length > 0) toast.message(skipped.map((r) => `${r.subject}: ${r.message}`).join("\n"));
}

const fromOps = (results: OpResult[]): Outcome[] => results.map((r) => ({ ...r, subject: r.agent }));
const fromInstalls = (results: InstallResult[]): Outcome[] => results.map((r) => ({ ...r, subject: r.skill }));

export function useMutations(rpc: Rpc, refetch: () => void) {
  const [busy, setBusy] = useState(false);
  const run = useCallback(
    async (work: () => Promise<Outcome[]>): Promise<boolean> => {
      setBusy(true);
      try {
        const results = await work();
        summarize(results);
        refetch();
        return !results.some((r) => r.outcome === "error");
      } catch (cause) {
        toast.error(describeError(cause));
        return false;
      } finally {
        setBusy(false);
      }
    },
    [refetch],
  );

  return {
    busy,
    sync: (skills: string[], agents: string[], mode: SyncMode, force = false) =>
      run(async () => fromOps((await rpc.call("sync", { skills, agents, mode, force })).results)),
    remove: (skill: string, agents: string[], force = false) =>
      run(async () => fromOps((await rpc.call("remove", { skill, agents, force })).results)),
    adopt: (skill: string, from: string, force = false) =>
      run(async () => fromOps([await rpc.call("adopt", { skill, from, force })])),
    install: (source: string, agents: string[], force = false) =>
      run(async () => fromInstalls((await rpc.call("install", { source, agents, force })).results)),
    setTags: (skill: string, tags: string[]) =>
      run(async () => {
        await rpc.call("setTags", { skill, tags });
        return [];
      }),
    setSource: (skill: string, source: string) =>
      run(async () => {
        const { lock } = await rpc.call("setSource", { skill, source });
        return [{ outcome: "done", message: `source set to ${lock.source}`, subject: skill }];
      }),
    checkUpdates: (skills?: string[]) =>
      run(async () => {
        const { checks } = await rpc.call("checkUpdates", skills === undefined ? {} : { skills });
        const updates = checks.filter((c) => c.state === "update-available" || c.state === "modified-and-update").length;
        const failed = checks.filter((c) => c.state === "error");
        if (failed.length > 0) toast.warning(`${failed.length} check${failed.length === 1 ? "" : "s"} failed`);
        toast.message(updates === 0 ? "Everything is up to date" : `${updates} update${updates === 1 ? "" : "s"} available`);
        return [];
      }),
    /** Check one skill against its source and apply the update if there is one. */
    refresh: (skill: string) =>
      run(async () => {
        const { checks } = await rpc.call("checkUpdates", { skills: [skill] });
        const check = checks[0];
        if (check === undefined) return [];
        if (check.state === "error") return [{ outcome: "error", message: check.message ?? "check failed", subject: skill }];
        if (check.state === "untracked") return [{ outcome: "error", message: "no source recorded; set one first", subject: skill }];
        if (check.state === "modified-and-update") {
          return [{ outcome: "skipped", message: "upstream changed but you edited this locally; open the card to choose", subject: skill }];
        }
        if (check.state !== "update-available") {
          return [{ outcome: "skipped", message: check.state === "modified" ? "edited locally; upstream unchanged" : "already up to date", subject: skill }];
        }
        const { results } = await rpc.call("update", { skills: [skill], force: false });
        return results.map((r) => ({ ...r, subject: r.skill }));
      }),
    update: (skills?: string[], force = false) =>
      run(async () => {
        const { results } = await rpc.call("update", { ...(skills === undefined ? {} : { skills }), force });
        return results.map((r) => ({ ...r, subject: r.skill }));
      }),
  };
}

export type Mutations = ReturnType<typeof useMutations>;
