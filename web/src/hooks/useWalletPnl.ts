import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { fetchWalletPnl } from "../api/client";
import { ApiError } from "../api/types";

/** Minutes east of UTC, the sign convention the API uses. Jakarta is +420. */
export function localTzOffsetMinutes(): number {
  return -new Date().getTimezoneOffset();
}

/**
 * A cold wallet takes a minute or two to reconstruct, so the server runs the
 * walk as a background job and answers `pending` until it lands. This polls
 * only while that is true — once the report arrives it stops, because realized
 * P&L for days that have already ended does not move.
 */
export function useWalletPnl(address: string | null, tzOffsetMinutes: number) {
  return useQuery({
    queryKey: ["wallet-pnl", address?.toLowerCase(), tzOffsetMinutes],
    queryFn: () => fetchWalletPnl(address!, { tzOffsetMinutes }),
    enabled: Boolean(address),
    staleTime: 120_000,
    refetchInterval: (query) => (query.state.data?.pending ? 4_000 : false),
    // A 400 means the address is malformed. Retrying cannot change that.
    retry: (failureCount, error) => !(error instanceof ApiError && error.status === 400) && failureCount < 2,
  });
}

/**
 * Forcing a refresh discards the cached walk and starts a new one, so the
 * answer is a `pending` marker rather than fresh numbers — writing it into the
 * cache is what re-arms the poll above.
 */
export function useRefreshWalletPnl(address: string | null, tzOffsetMinutes: number) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => fetchWalletPnl(address!, { tzOffsetMinutes, force: true }),
    onSuccess: (data) =>
      queryClient.setQueryData(["wallet-pnl", address?.toLowerCase(), tzOffsetMinutes], data),
  });
}
