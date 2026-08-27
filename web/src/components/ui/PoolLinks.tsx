import clsx from "clsx";
import { Globe2, UserRound, UsersRound } from "lucide-react";
import type { SyntheticEvent } from "react";
import type { Pool } from "../../api/types";

function stopRowInteraction(event: SyntheticEvent) {
  event.stopPropagation();
}

export function PoolLinks({ pool, className }: { pool: Pool; className?: string }) {
  const website = pool.links?.website;
  const community = pool.links?.community;
  if (!website && !community) return null;

  const symbol = pool.baseToken.symbol ?? "token";
  const isXCommunity = community ? /\/i\/communities\//i.test(community) : false;
  const CommunityIcon = isXCommunity ? UsersRound : UserRound;

  const linkClass =
    "inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-md transition-colors hover:bg-ink-3 hover:text-txt-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-reticle";

  return (
    <span
      className={clsx("inline-flex shrink-0 items-center gap-0.5", className)}
      role="group"
      aria-label={`${symbol} links`}
    >
      {community && (
        <a
          href={community}
          target="_blank"
          rel="noreferrer noopener"
          title={isXCommunity ? `Open ${symbol} X Community` : `Open ${symbol} on X`}
          aria-label={isXCommunity ? `Open ${symbol} X Community` : `Open ${symbol} on X`}
          className={clsx(linkClass, "text-bloom")}
          onClick={stopRowInteraction}
          onKeyDown={stopRowInteraction}
        >
          <CommunityIcon size={14} strokeWidth={1.8} aria-hidden />
        </a>
      )}
      {website && (
        <a
          href={website}
          target="_blank"
          rel="noreferrer noopener"
          title={`Open ${symbol} website`}
          aria-label={`Open ${symbol} website`}
          className={clsx(linkClass, "text-txt-1")}
          onClick={stopRowInteraction}
          onKeyDown={stopRowInteraction}
        >
          <Globe2 size={14} strokeWidth={1.7} aria-hidden />
        </a>
      )}
    </span>
  );
}
