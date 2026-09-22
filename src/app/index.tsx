// bb-plugin-skill-manager — frontend entry. Registers the Skills sidebar
// page: two tabs (Installed, Find skills) and a full-height reader mode.
import { useState } from "react";
import { definePluginApp } from "@get-bb/plugin-sdk/app";
import { GraduationCapIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { SegmentedControl } from "./components/primitives";
import { SkillReader } from "./components/skill-reader";
import { useMutations } from "./hooks/use-mutations";
import { useStatus } from "./hooks/use-status";
import { FindPage } from "./pages/find";
import { InstalledPage } from "./pages/installed";

type Tab = "installed" | "find";

const TABS: Array<{ key: Tab; label: string }> = [
  { key: "installed", label: "Installed" },
  { key: "find", label: "Find skills" },
];

/** Layout-shaped placeholder shown only before the first scan arrives. */
function PageSkeleton() {
  const block = (className: string) => <div aria-hidden className={`animate-pulse rounded-md bg-muted ${className}`} />;
  return (
    <div className="space-y-4" aria-busy="true" aria-label="Loading skills">
      <div className="flex items-end justify-between">
        {block("h-10 w-16")}
        <div className="flex gap-1">{Array.from({ length: 5 }, (_, i) => <span key={i}>{block("h-8 w-12")}</span>)}</div>
      </div>
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">{Array.from({ length: 4 }, (_, i) => <span key={i}>{block("h-24 w-full rounded-xl")}</span>)}</div>
      <div className="flex gap-2">{block("h-8 w-56")}{block("h-8 w-28")}{block("h-8 w-32")}</div>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">{Array.from({ length: 9 }, (_, i) => <span key={i}>{block("h-24 w-full rounded-lg")}</span>)}</div>
    </div>
  );
}

function SkillsPage() {
  const { rpc, status, error, refetch } = useStatus();
  const mutations = useMutations(rpc, refetch);
  const [tab, setTab] = useState<Tab>("installed");
  const [reading, setReading] = useState<string | null>(null);

  if (reading !== null && status !== null) {
    // Reader mode: the page does not scroll; its two panes do.
    return (
      <div className="flex h-full min-h-0 flex-1 flex-col">
        <div className="mx-auto box-border flex min-h-0 w-full max-w-6xl flex-1 flex-col px-4 pb-4 pt-4 md:px-6">
          <SkillReader initial={reading} status={status} rpc={rpc} onClose={() => setReading(null)} />
        </div>
      </div>
    );
  }

  return (
    <div className="h-full min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto box-border w-full max-w-5xl px-4 pb-8 pt-4 md:px-6">
        <div className="mb-4 flex items-center justify-between">
          <SegmentedControl value={tab} options={TABS} onChange={setTab} />
          {status !== null ? (
            <span className="text-xs text-muted-foreground">
              {status.skills.length} skills · {status.agents.filter((agent) => agent.exists).length} agents
            </span>
          ) : null}
        </div>
        {error !== null ? (
          <p role="alert" className="mb-3 text-sm text-destructive-text">
            {error}
          </p>
        ) : null}
        {status === null ? (
          <PageSkeleton />
        ) : tab === "installed" ? (
          <InstalledPage status={status} rpc={rpc} mutations={mutations} refetch={refetch} onOpen={setReading} />
        ) : (
          <FindPage status={status} rpc={rpc} mutations={mutations} />
        )}
      </div>
    </div>
  );
}

const ICON = "skill-manager-cap";

export default definePluginApp((app) => {
  // The sidebar entry uses the same graduation cap as the manifest icon.
  app.experimental_icons.register({
    name: ICON,
    component: ({ className }) => <HugeiconsIcon icon={GraduationCapIcon} className={className} strokeWidth={1.75} />,
  });
  app.slots.navPanel({
    id: "skills",
    title: "Skills",
    icon: ICON,
    path: "skills",
    component: SkillsPage,
  });
});
