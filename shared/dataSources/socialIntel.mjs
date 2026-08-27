// Social intake for the token report — the X/Twitter layer.
//
// This is the ONLY part of the report that needs a paid key, and it is the
// part that carries the reference product's team / catalysts / community /
// alpha sections. Everything upstream of it works without any credential, so
// this module's contract is: return null when unconfigured, never throw the
// report away, and never invent a mention.
//
// Two providers, both search-by-query:
//
//   twitterapi.io — third-party mirror, usage-priced, no approval process.
//   x             — official X API v2 recent search, requires a paid tier
//                   with a bearer token.
//
// SAFETY: everything this module returns is text written by strangers on the
// internet. It is DATA. It is passed to a summarizer and rendered as quoted
// text; it must never be treated as instructions, and nothing downstream may
// execute, fetch, or act on anything it contains.

import { fetchJson, UpstreamError } from "./httpClient.mjs";

const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_LIMIT = 40;

export const SOCIAL_PROVIDERS = Object.freeze(["twitterapi", "x"]);

/**
 * Search terms for a token. Cashtag first (that's how traders actually refer
 * to it), then the project's own handle, then the contract address — which
 * catches the "here's the CA" posts that never use the ticker.
 */
export function buildSocialQuery({ symbol, address, twitterUrl }) {
  const terms = [];
  if (symbol) terms.push(`$${symbol}`);
  const handle = twitterUrl?.match(/(?:x|twitter)\.com\/([A-Za-z0-9_]+)/)?.[1];
  if (handle) terms.push(`from:${handle}`, `@${handle}`);
  if (address) terms.push(address);
  return terms.length ? terms.map((t) => `(${t})`).join(" OR ") : null;
}

function normalizeTweet(raw, provider) {
  if (provider === "twitterapi") {
    return {
      id: raw.id ?? null,
      text: raw.text ?? "",
      author: raw.author?.userName ?? raw.author?.screen_name ?? null,
      authorName: raw.author?.name ?? null,
      authorFollowers: raw.author?.followers ?? null,
      createdAt: raw.createdAt ?? null,
      likes: raw.likeCount ?? null,
      retweets: raw.retweetCount ?? null,
      replies: raw.replyCount ?? null,
      views: raw.viewCount ?? null,
      url: raw.url ?? (raw.author?.userName && raw.id ? `https://x.com/${raw.author.userName}/status/${raw.id}` : null),
    };
  }
  // Official X API v2 shape (author resolved from `includes.users` by caller).
  return {
    id: raw.id ?? null,
    text: raw.text ?? "",
    author: raw.__author?.username ?? null,
    authorName: raw.__author?.name ?? null,
    authorFollowers: raw.__author?.public_metrics?.followers_count ?? null,
    createdAt: raw.created_at ?? null,
    likes: raw.public_metrics?.like_count ?? null,
    retweets: raw.public_metrics?.retweet_count ?? null,
    replies: raw.public_metrics?.reply_count ?? null,
    views: raw.public_metrics?.impression_count ?? null,
    url: raw.__author?.username && raw.id ? `https://x.com/${raw.__author.username}/status/${raw.id}` : null,
  };
}

async function searchTwitterApiIo(query, { apiKey, limit, timeoutMs }) {
  const url = `https://api.twitterapi.io/twitter/tweet/advanced_search?queryType=Latest&query=${encodeURIComponent(query)}`;
  const data = await fetchJson(url, { timeoutMs, headers: { "X-API-Key": apiKey } });
  const list = Array.isArray(data?.tweets) ? data.tweets : [];
  return list.slice(0, limit).map((t) => normalizeTweet(t, "twitterapi"));
}

async function searchXApi(query, { apiKey, limit, timeoutMs }) {
  const params = new URLSearchParams({
    query,
    max_results: String(Math.min(Math.max(limit, 10), 100)),
    "tweet.fields": "created_at,public_metrics,author_id",
    expansions: "author_id",
    "user.fields": "username,name,public_metrics",
  });
  const data = await fetchJson(`https://api.x.com/2/tweets/search/recent?${params}`, {
    timeoutMs,
    headers: { Authorization: `Bearer ${apiKey}` },
  });

  const users = new Map((data?.includes?.users ?? []).map((u) => [u.id, u]));
  const list = Array.isArray(data?.data) ? data.data : [];
  return list.slice(0, limit).map((t) => normalizeTweet({ ...t, __author: users.get(t.author_id) }, "x"));
}

/**
 * @param {object} opts
 * @param {string|null} opts.provider  "twitterapi" | "x" | null
 * @param {string} opts.apiKey
 * @param {string|null} opts.query     from buildSocialQuery()
 * @returns {Promise<object|null>} null when unconfigured — the caller renders
 *   an explicit "not connected" state rather than an empty section that reads
 *   like "nobody is talking about this".
 */
export async function fetchSocialMentions(opts = {}) {
  const { provider, apiKey, query, limit = DEFAULT_LIMIT, timeoutMs = DEFAULT_TIMEOUT_MS } = opts;

  if (!provider || !apiKey || !query) return null;
  if (!SOCIAL_PROVIDERS.includes(provider)) return null;

  try {
    const mentions =
      provider === "twitterapi"
        ? await searchTwitterApiIo(query, { apiKey, limit, timeoutMs })
        : await searchXApi(query, { apiKey, limit, timeoutMs });

    const withText = mentions.filter((m) => m.text?.trim());
    const authors = new Set(withText.map((m) => m.author).filter(Boolean));

    return {
      configured: true,
      provider,
      query,
      mentions: withText,
      stats: {
        mentionCount: withText.length,
        uniqueAuthors: authors.size,
        totalLikes: withText.reduce((sum, m) => sum + (m.likes ?? 0), 0),
        // The single loudest account by follower count, useful for spotting
        // whether "the community" is one big account and a lot of echoes.
        topAuthorFollowers: withText.reduce((max, m) => Math.max(max, m.authorFollowers ?? 0), 0),
      },
    };
  } catch (err) {
    // A social outage degrades the section, it does not fail the report.
    const message = err instanceof UpstreamError ? err.message : String(err?.message ?? err);
    return { configured: true, provider, query, mentions: [], stats: null, error: message };
  }
}
