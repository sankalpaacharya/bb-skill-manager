// The status payload, kept current by the server's realtime signal.
import { useCallback, useEffect, useState } from "react";
import { useRealtime, useRpc } from "@get-bb/plugin-sdk/app";
import { SKILLS_CHANGED } from "../../server/contract";
import { describeError } from "../lib/format";
import type { RpcContract, Status } from "../lib/types";

/** Last payload seen in this window, so reopening the page paints at once and refreshes behind. */
let remembered: Status | null = null;

export function useStatus() {
  const rpc = useRpc<RpcContract>();
  const [status, setStatus] = useState<Status | null>(remembered);
  const [error, setError] = useState<string | null>(null);
  const refetch = useCallback(() => {
    rpc.call("status").then(
      (next) => {
        remembered = next;
        setStatus(next);
        setError(null);
      },
      (cause: unknown) => setError(describeError(cause)),
    );
  }, [rpc]);
  useEffect(() => {
    refetch();
  }, [refetch]);
  useRealtime(SKILLS_CHANGED, refetch);
  return { rpc, status, error, refetch };
}
