import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { fetchTokenReport } from "../api/client";
import { ApiError } from "../api/types";

/**
 * A token report is far more expensive than a pool row — up to six upstream
 * calls plus an optional LLM round-trip — and its fundamentals don't move on
 * the screener's 60-second cadence. So this deliberately does NOT poll; the
 * server caches for minutes and the user refreshes when they want to.
 */
export function useTokenReport(address: string | null) {
  return useQuery({
    queryKey: ["token", address],
    queryFn: () => fetchTokenReport(address!),
    enabled: Boolean(address),
    staleTime: 60_000,
    // A 404 means this address isn't a token on this chain. Retrying can't
    // change that answer, and each retry costs the same upstream calls.
    retry: (failureCount, error) => !(error instanceof ApiError && error.status === 404) && failureCount < 2,
  });
}

export function useRefreshTokenReport(address: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => fetchTokenReport(address!, { force: true }),
    onSuccess: (data) => queryClient.setQueryData(["token", address], data),
  });
}
