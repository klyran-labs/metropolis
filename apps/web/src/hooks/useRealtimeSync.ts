import { useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { getAccessToken } from "../api";
import { configuration } from "../configuration";
import { startRealtime } from "../realtime";

/** Keeps cached data fresh from gateway push events. Mount once for a signed-in workspace. */
export function useRealtimeSync(enabled: boolean) {
  const queryClient = useQueryClient();
  useEffect(() => {
    if (!enabled) return;
    return startRealtime({
      url: `${configuration.apiBaseUrl}/telemetry/stream`,
      getToken: getAccessToken,
      onInvalidate: (keys) => {
        if (keys === "all") void queryClient.invalidateQueries();
        else for (const queryKey of keys) void queryClient.invalidateQueries({ queryKey });
      },
    });
  }, [enabled, queryClient]);
}
