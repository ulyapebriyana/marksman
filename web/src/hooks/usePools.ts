import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { fetchHistory, fetchPools, fetchStatus, postAlert } from "../api/client";
import type { LpPresetKey, PresetKey } from "../api/types";

/**
 * `lpPreset` only re-gates the LP view; callers that don't render it (the
 * landing page) can omit it and share the default's cache entry.
 */
export function usePools(preset: PresetKey, lpPreset: LpPresetKey = "carry") {
  return useQuery({
    queryKey: ["pools", preset, lpPreset],
    queryFn: () => fetchPools({ preset, lpPreset }),
    refetchInterval: 20_000,
    refetchOnWindowFocus: true,
    // Keep the previous preset's rows on screen while the new one resolves —
    // switching presets re-evaluates a cached scan, so the swap is near-instant
    // and a skeleton would flash for no reason.
    placeholderData: (previous) => previous,
  });
}

export function useForceRescan(preset: PresetKey, lpPreset: LpPresetKey) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => fetchPools({ preset, lpPreset, force: true }),
    onSuccess: (data) => {
      queryClient.setQueryData(["pools", preset, lpPreset], data);
      queryClient.invalidateQueries({ queryKey: ["status"] });
      queryClient.invalidateQueries({ queryKey: ["history"] });
    },
  });
}

export function useStatus() {
  return useQuery({
    queryKey: ["status"],
    queryFn: fetchStatus,
    refetchInterval: 20_000,
  });
}

export function useHistory() {
  return useQuery({
    queryKey: ["history"],
    queryFn: () => fetchHistory(100),
    refetchInterval: 30_000,
  });
}

export function useSendAlert() {
  return useMutation({
    mutationFn: ({ address, preset }: { address: string; preset: PresetKey }) => postAlert(address, preset),
  });
}
