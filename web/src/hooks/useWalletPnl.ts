import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { fetchWalletPnl } from "../api/client";
import { ApiError } from "../api/types";

/** Minutes east of UTC, the sign convention the API uses. Jakarta is +420. */
export function localTzOffsetMinutes(): number {
  return -new Date().getTimezoneOffset();
}

/**
 * Walking a wallet costs one explorer call per LP transaction plus a price
 * series per pool, so this deliberately does NOT poll. Realized P&L for days
 * that have already ended does not move; the server caches for minutes and the
 * user refreshes when they want to.
 */
export function useWalletPnl(address: string | null, tzOffsetMinutes: number) {
  return useQuery({
    queryKey: ["wallet-pnl", address?.toLowerCase(), tzOffsetMinutes],
    queryFn: () => fetchWalletPnl(address!, { tzOffsetMinutes }),
    enabled: Boolean(address),
    staleTime: 120_000,
    // A 400 means the address is malformed. Retrying cannot change that.
    retry: (failureCount, error) => !(error instanceof ApiError && error.status === 400) && failureCount < 2,
  });
}

export function useRefreshWalletPnl(address: string | null, tzOffsetMinutes: number) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => fetchWalletPnl(address!, { tzOffsetMinutes, force: true }),
    onSuccess: (data) =>
      queryClient.setQueryData(["wallet-pnl", address?.toLowerCase(), tzOffsetMinutes], data),
  });
}
