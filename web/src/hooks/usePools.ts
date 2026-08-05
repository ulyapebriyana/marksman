import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { fetchHistory, fetchPools, fetchStatus, postAlert } from "../api/client";
import type { PresetKey } from "../api/types";

export function usePools(preset: PresetKey) {
  return useQuery({
    queryKey: ["pools", preset],
    queryFn: () => fetchPools({ preset }),
    refetchInterval: 20_000,
    refetchOnWindowFocus: true,
  });
}

export function useForceRescan(preset: PresetKey) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => fetchPools({ preset, force: true }),
    onSuccess: (data) => {
      queryClient.setQueryData(["pools", preset], data);
      queryClient.invalidateQueries({ queryKey: ["status"] });
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
